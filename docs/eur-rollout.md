# EUR 帳本與 Excel 匯入

每個帳本限定 TWD 或 EUR 一種幣別。首頁、紀錄、日報、月報和圖表加總
`original_amount`，依帳本時區分日。不支援混合幣別或自動換匯。
TWD 的 `amount_twd` 等於原額、匯率為 1。EUR 的台幣金額及匯率為 NULL，
CSV 對應欄位留空，不能解讀為零。既有 TWD 交易不做資料改寫。

## 正式上線順序

1. 備份雲端資料庫並保留現有部署版本。
2. 在目標 Supabase SQL Editor 完整執行
   `drizzle/migrations/0001_eur_ledgers.sql` 一次。
   不要重跑 `0000`，也不要在正式資料庫執行 `tests/db`。
3. 部署這份程式。以 TWD 帳號驗證新增、修改、刪除、報表及 CSV。
4. 才執行私人匯入 SQL。GitHub 不儲存任何真實交易或個人 Email。
5. 朋友在「設定 → 目前帳本」選擇「德國生活（EUR）」。選擇記在這台裝置，
   其他裝置需各自切換。原本的預設 TWD 帳本與紀錄保留。
6. 核對匯入筆數、每月總額、日期與分類，再測試 EUR 新增、修改、刪除、CSV。

若 migration 失敗，整個 transaction 回滾，先排查錯誤。若前端需回退，
只回退前端不會刪除 EUR 資料，但舊版不具 EUR 功能，不可用舊版編輯 EUR 交易。
不要在已有 EUR 資料時直接還原 TWD-only constraint。資料回退須用備份另行規劃。

## 從月分工作表產生私人 SQL

Python 3.10+，只用標準函式庫，不需要 Supabase 金鑰。

```sh
python3 scripts/import_expenses.py /path/to/expenses.xlsx \
  --email '<target-email>' --timezone Europe/Berlin \
  --ledger-name 德國生活 --output /private/path/expense-import.sql
```

只讀取名稱為 YYYY-MM 的工作表。日期、項目、分類與金額必須完整。
明細 A～D 不接受公式。依每筆兩位小數處理 Excel 浮點尾差，並與快取月總計核對。
付款方式標為「未記錄」。來源只有日期時補設當地中午 12:00，在備註保留來源列及
時間假設。不會推測付款方式、匯率、支出用途或將押金改成退款。
分類採原分類的中文部分，避免雙語名稱超過資料庫 20 字限制。

SQL 依 Email 找到既有帳號，新增非預設的 EUR 帳本，不修改其他帳本或帳號。
來源檔案 SHA-256、工作表、列號產生穩定交易 ID。相同檔案完整重跑會核對資料後
不重複新增；部分匯入、已修改紀錄或同名帳本已有不相符資料時整批停止。
修改後的 Excel 不是增量同步來源，不能直接重匯覆蓋。

## 測試

- GitHub Actions：型別、單元測試、Vercel build。
- PostgreSQL 17 測試：先建 M0 與既有 TWD 資料，再套新 migration；驗證 EUR
  CRUD 報表、夏冬時區邊界、禁止混幣與假匯率、RLS 跨帳號讀寫和匯入重跑。
- Python：`uv run --with pytest==8.4.2 pytest tests/test_import_expenses.py -q`。
  沒有設定 PGHOST 時只執行檔案解析測試，資料庫測試會跳過。
- iPhone、真實 Supabase Auth 與正式資料的驗收仍須另外執行。
