# Pixel Ledger

以台灣繁體中文設計的個人記帳 PWA，使用 TanStack Start、Supabase 和 PostgreSQL。每個帳本支援 TWD 或 EUR，可在設定切換帳本；韓元與匯率轉換尚未實作。EUR migration、上線順序及私人 Excel 匯入請見 [EUR 說明](docs/eur-rollout.md)。

## 本機開發

使用 Bun 和 repository 的 `bun.lock`：

```sh
bun install --frozen-lockfile
bunx tsc --noEmit
bun run test
bun run build
bun run dev
```

設定 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`；伺服器環境可使用 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY`。`SUPABASE_SERVICE_ROLE_KEY` 僅供需要管理權限的伺服器程式使用，不可放入前端或提交至 Git。Supabase 驗證的網站 URL、重新導向 URL 與寄信服務須依部署環境設定。

## 資料與安全性

資料表 `ledgers`、`transactions`、`categories`、`payment_methods` 的結構和 RLS 政策見 `drizzle/migrations/0000_pixel_ledger_m0.sql`，EUR 擴充見 `0001_eur_ledgers.sql`。每張表依 `auth.uid()` 限制資料存取；交易的複合外鍵要求帳本、分類與付款方式屬於相同使用者。預設帳本以部分唯一索引限制每位使用者最多一個。`ledger_report` 依帳本時區與 `occurred_at` 加總原幣金額，金額以 PostgreSQL numeric 與字串／整數分處理。EUR 不換算台幣，換算欄位留空。正式使用前仍須驗證真實帳號與完整流程。

## iPhone 安裝與限制

部署 HTTPS 後在 iPhone Safari 開啟網址，點「分享」→「加入主畫面」，再從主畫面開啟。不支援離線新增或同步，也未實作提醒、旅遊期間管理及匯率換算。

## 手動驗收清單

- 註冊、驗證郵件、登入、重設密碼；檢查預設帳本只建立一次。
- 新增、修改、刪除交易，重新整理後資料仍存在，報表立即更新。
- 台北午夜、跨月、零筆資料，以及分類／付款方式結算。
- 兩個帳號交叉讀取或引用對方資料必須被拒絕。
- 匯出 CSV 並在 Excel 驗證內容、中文及公式字元處理。
- iPhone Safari 的窄螢幕表單、鍵盤、加入主畫面與開啟。

