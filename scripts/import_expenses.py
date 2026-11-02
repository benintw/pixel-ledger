"""Convert monthly expense XLSX sheets to an atomic, repeat-safe SQL import.

Python 3.10+, standard library only. Never uploads data or connects to a database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import uuid
import zipfile
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def read_expenses(path: Path, timezone: str) -> list[dict[str, str]]:
    """Read dated transaction rows, excluding templates, formulas and totals."""
    zone = ZoneInfo(timezone)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    records: list[dict[str, str]] = []
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        props = workbook.find("m:workbookPr", NS)
        epoch = date(1904, 1, 1) if props is not None and props.get("date1904") in {"1", "true"} else date(1899, 12, 30)
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {r.get("Id"): r.get("Target", "") for r in relationships}
        strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = [
                "".join(t.text or "" for t in item.findall(".//m:t", NS))
                for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)
            ]
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            month = sheet.get("name", "")
            if not re.fullmatch(r"\d{4}-\d{2}", month):
                continue
            target = targets[sheet.get(REL_ID)]
            part = target.lstrip("/") if target.startswith("/") else "xl/" + target
            root = ET.fromstring(archive.read(part))
            monthly: list[dict[str, str]] = []
            stated_total: Decimal | None = None
            for row in root.findall("m:sheetData/m:row", NS):
                values: dict[str, str] = {}
                formulas: set[str] = set()
                for cell in row.findall("m:c", NS):
                    column = re.sub(r"\d", "", cell.get("r", ""))
                    value = cell.find("m:v", NS)
                    text = value.text or "" if value is not None else ""
                    if cell.get("t") == "s":
                        text = strings[int(text)]
                    elif cell.get("t") == "inlineStr":
                        text = "".join(t.text or "" for t in cell.findall(".//m:t", NS))
                    values[column] = text
                    if cell.find("m:f", NS) is not None:
                        formulas.add(column)
                if "當月總計" in values.get("C", ""):
                    if values.get("D"):
                        stated_total = Decimal(values["D"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    continue
                if int(row.get("r", "0")) < 5:
                    continue
                if not any(values.get(c) for c in ("A", "B", "C", "D")):
                    continue
                if not all(values.get(c) for c in ("A", "B", "C", "D")) or formulas & {"A", "B", "C", "D"}:
                    raise ValueError(f"{month} 第 {row.get('r')} 列欄位缺漏或含明細公式")
                serial = Decimal(values["A"])
                if serial != serial.to_integral_value():
                    raise ValueError("來源含時間，請另行處理，不可直接補設中午")
                local_date = epoch + timedelta(days=int(serial))
                if local_date.strftime("%Y-%m") != month:
                    raise ValueError(f"{month} 的日期不在該月份")
                amount = Decimal(values["D"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if not amount.is_finite() or amount <= 0:
                    raise ValueError("支出金額必須大於零")
                category = values["C"].split(" ")[0].strip()
                description = values["B"].strip()
                notes = f"Excel 匯入：{month} 第 {row.get('r')} 列；原始資料僅日期，時間補設為 {timezone} 12:00；付款方式未記錄。"
                if values.get("F") and "F" not in formulas:
                    notes += " 原備註：" + values["F"]
                if not 1 <= len(category) <= 20 or not 1 <= len(description) <= 100 or len(notes) > 500:
                    raise ValueError("內容超過資料庫欄位長度，未截斷，請人工處理")
                monthly.append({
                    "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"pixel-ledger:{digest}:{month}:{row.get('r')}")),
                    "description": description,
                    "category": category,
                    "amount": str(amount),
                    "occurred_at": datetime.combine(local_date, datetime.min.time()).replace(hour=12, tzinfo=zone).isoformat(),
                    "notes": notes,
                })
            total = sum((Decimal(r["amount"]) for r in monthly), Decimal("0"))
            if stated_total is not None and total != stated_total:
                raise ValueError(f"{month} 明細總額 {total} 與來源總計 {stated_total} 不符")
            records.extend(monthly)
    if not records:
        raise ValueError("找不到可匯入明細")
    return records


def build_import_sql(records: list[dict[str, str]], email: str, timezone: str, ledger_name: str) -> str:
    """Build SQL that creates an isolated EUR ledger and verifies every inserted row."""
    expected = sum((Decimal(r["amount"]) for r in records), Decimal("0"))
    data = json.dumps({"email": email, "timezone": timezone, "name": ledger_name, "rows": records}, ensure_ascii=False)
    delimiter = "$import_" + uuid.uuid4().hex + "$"
    template = """-- Private financial data: do not commit this generated file to GitHub.
BEGIN;
CREATE TEMP TABLE expense_import_payload(data jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO expense_import_payload VALUES (__DATA__);
DO $import$
DECLARE
  payload jsonb;
  owner_id uuid;
  target_ledger uuid;
  method_id uuid;
  ledger_matches integer;
  existing integer;
BEGIN
  SELECT data INTO STRICT payload FROM expense_import_payload;
  SELECT id INTO STRICT owner_id FROM auth.users WHERE lower(email) = lower(payload->>'email');
  PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  PERFORM 1 FROM auth.users WHERE id = owner_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_currency_values'
    AND conrelid = 'public.transactions'::regclass) THEN
    RAISE EXCEPTION '請先套用 0001_eur_ledgers.sql';
  END IF;
  SELECT count(*) INTO ledger_matches FROM public.ledgers WHERE user_id = owner_id AND name = payload->>'name';
  IF ledger_matches > 1 THEN RAISE EXCEPTION '同名帳本不唯一，停止匯入'; END IF;
  IF ledger_matches = 0 THEN
    INSERT INTO public.ledgers(user_id,name,type,base_currency,timezone,is_default)
    VALUES(owner_id,payload->>'name','daily','EUR',payload->>'timezone',false)
    RETURNING id INTO target_ledger;
  ELSE
    SELECT id INTO STRICT target_ledger FROM public.ledgers
    WHERE user_id = owner_id AND name = payload->>'name'
      AND base_currency = 'EUR' AND timezone = payload->>'timezone' AND NOT is_default
    FOR UPDATE;
  END IF;
  SELECT count(*) INTO existing FROM public.transactions t
  JOIN jsonb_to_recordset(payload->'rows') AS r(id uuid) ON r.id = t.id;
  IF existing NOT IN (0, __COUNT__) THEN RAISE EXCEPTION '發現部分匯入，停止'; END IF;
  IF existing = 0 AND EXISTS (SELECT 1 FROM public.transactions WHERE transactions.ledger_id = target_ledger) THEN
    RAISE EXCEPTION '目標帳本已有其他資料，停止以避免重複匯入';
  END IF;
  INSERT INTO public.categories(user_id,name)
  SELECT DISTINCT owner_id,r.category FROM jsonb_to_recordset(payload->'rows') AS r(category text)
  ON CONFLICT(user_id,name) DO NOTHING;
  INSERT INTO public.payment_methods(user_id,name) VALUES(owner_id,'未記錄')
  ON CONFLICT(user_id,name) DO NOTHING;
  SELECT id INTO STRICT method_id FROM public.payment_methods WHERE user_id = owner_id AND name = '未記錄';
  IF existing = 0 THEN
    INSERT INTO public.transactions(id,user_id,ledger_id,description,category_id,payment_method_id,
      original_amount,original_currency,amount_twd,exchange_rate_to_twd,occurred_at,notes)
    SELECT r.id,owner_id,target_ledger,r.description,c.id,method_id,r.amount,'EUR',NULL,NULL,r.occurred_at,r.notes
    FROM jsonb_to_recordset(payload->'rows') AS r(id uuid,description text,category text,amount numeric,occurred_at timestamptz,notes text)
    JOIN public.categories c ON c.user_id = owner_id AND c.name = r.category;
  END IF;
  IF (SELECT count(*) FROM public.transactions t
    JOIN jsonb_to_recordset(payload->'rows') AS r(id uuid,description text,category text,amount numeric,occurred_at timestamptz,notes text)
      ON t.id = r.id
    JOIN public.categories c ON c.id = t.category_id AND c.user_id = owner_id AND c.name = r.category
    WHERE t.user_id = owner_id AND t.ledger_id = target_ledger AND t.description = r.description
      AND t.payment_method_id = method_id AND t.original_currency = 'EUR'
      AND t.original_amount = r.amount AND t.occurred_at = r.occurred_at AND t.notes = r.notes
      AND t.amount_twd IS NULL AND t.exchange_rate_to_twd IS NULL) <> __COUNT__ THEN
    RAISE EXCEPTION '逐筆核對失敗，全部回滾';
  END IF;
  IF (SELECT sum(t.original_amount) FROM public.transactions t
      JOIN jsonb_to_recordset(payload->'rows') AS r(id uuid) ON t.id = r.id) <> __TOTAL__ THEN
    RAISE EXCEPTION '匯入總額不符，全部回滾';
  END IF;
END $import$;
SELECT l.name,l.base_currency,l.timezone,count(t.id) AS transaction_count,sum(t.original_amount) AS total_eur
FROM public.ledgers l JOIN auth.users u ON u.id = l.user_id
LEFT JOIN public.transactions t ON t.ledger_id = l.id
WHERE lower(u.email) = lower((SELECT data->>'email' FROM expense_import_payload))
AND l.name = (SELECT data->>'name' FROM expense_import_payload)
GROUP BY l.id;
COMMIT;
"""
    return template.replace("__COUNT__", str(len(records))).replace("__TOTAL__", str(expected)).replace("__DATA__", f"{delimiter}{data}{delimiter}::jsonb")


def main() -> None:
    """Validate an XLSX and create a private SQL file without overwriting files."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xlsx", type=Path)
    parser.add_argument("--email", required=True)
    parser.add_argument("--timezone", default="Europe/Berlin")
    parser.add_argument("--ledger-name", default="德國生活")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    records = read_expenses(args.xlsx, args.timezone)
    sql = build_import_sql(records, args.email.strip(), args.timezone, args.ledger_name)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(sql)
    total = sum((Decimal(r["amount"]) for r in records), Decimal("0"))
    print(f"已建立 {args.output}：{len(records)} 筆，EUR {total}；尚未寫入資料庫。")


if __name__ == "__main__":
    main()
