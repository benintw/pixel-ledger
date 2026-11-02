"""Test source extraction and atomic import against synthetic data only."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from xml.sax.saxutils import escape

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/import_expenses.py"
SPEC = importlib.util.spec_from_file_location("expense_import", SCRIPT)
assert SPEC and SPEC.loader
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


def fixture_xlsx(path: Path, missing_amount: bool = False) -> None:
    """Build a minimal test ZIP, including an empty template and a cached total."""
    serial = (date(2026, 8, 18) - date(1899, 12, 30)).days
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    def text_cell(ref: str, value: str) -> str:
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
    amount = '' if missing_amount else '<c r="D5"><v>0.10000000000000001</v></c>'
    sheet = f'''<worksheet {ns}><sheetData>
    <row r="4">{text_cell('A4', '日期')}{text_cell('B4', '項目')}</row>
    <row r="5"><c r="A5"><v>{serial}</v></c>{text_cell('B5', "O'Brien coffee")}{text_cell('C5', '餐飲 Dining')}{amount}</row>
    <row r="6"><c r="A6"><v>{serial}</v></c>{text_cell('B6', 'Lunch')}{text_cell('C6', '餐飲 Dining')}<c r="D6"><v>0.20</v></c></row>
    <row r="7">{text_cell('C7', '當月總計 (Monthly Total)')}<c r="D7"><f>SUM(D5:D6)</f><v>0.30</v></c></row>
    </sheetData></worksheet>'''
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr('xl/workbook.xml', f'<workbook {ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="2026-08" r:id="r1"/><sheet name="空白模板" r:id="r2"/></sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>')
        archive.writestr('xl/worksheets/sheet1.xml', sheet)
        archive.writestr('xl/worksheets/sheet2.xml', f'<worksheet {ns}><sheetData/></worksheet>')


def test_exact_amounts_provenance_and_stable_ids(tmp_path: Path) -> None:
    """Keep exact cents, local dates and repeat identifiers without importing totals."""
    source = tmp_path / 'sample.xlsx'
    fixture_xlsx(source)
    rows = IMPORTER.read_expenses(source, 'Europe/Berlin')
    assert len(rows) == 2
    assert sum(Decimal(r['amount']) for r in rows) == Decimal('0.30')
    assert rows[0]['occurred_at'] == '2026-08-18T12:00:00+02:00'
    assert rows[0]['category'] == '餐飲'
    assert '付款方式未記錄' in rows[0]['notes']
    assert rows == IMPORTER.read_expenses(source, 'Europe/Berlin')


def test_missing_fields_stop_instead_of_silent_skip(tmp_path: Path) -> None:
    """Reject a partial transaction rather than dropping it from the import."""
    source = tmp_path / 'bad.xlsx'
    fixture_xlsx(source, missing_amount=True)
    with pytest.raises(ValueError, match='缺漏'):
        IMPORTER.read_expenses(source, 'Europe/Berlin')


@pytest.mark.skipif(not os.environ.get('PGHOST'), reason='requires test PostgreSQL')
def test_database_import_is_idempotent_and_preserves_twd(tmp_path: Path) -> None:
    """Run generated SQL twice, then verify a changed source record aborts replay."""
    source = tmp_path / 'sample.xlsx'
    fixture_xlsx(source)
    rows = IMPORTER.read_expenses(source, 'Europe/Berlin')
    sql = IMPORTER.build_import_sql(rows, 'owner@example.test', 'Europe/Berlin', '匯入測試')
    for _ in range(2):
        result = subprocess.run(['psql', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
    result = subprocess.run(['psql', '-Atc', "SELECT count(*),sum(original_amount) FROM public.transactions WHERE original_currency='EUR'"], capture_output=True, text=True, check=True)
    assert result.stdout.strip() == '2|0.30'
    result = subprocess.run(['psql', '-Atc', "SELECT count(*),sum(amount_twd) FROM public.transactions WHERE original_currency='TWD'"], capture_output=True, text=True, check=True)
    assert result.stdout.strip() == '1|13.61'
    subprocess.run(['psql', '-v', 'ON_ERROR_STOP=1', '-c', f"UPDATE public.transactions SET description='已修改' WHERE id='{rows[0]['id']}'"], check=True, capture_output=True)
    result = subprocess.run(['psql', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
    assert result.returncode != 0
    assert '逐筆核對失敗' in result.stderr
