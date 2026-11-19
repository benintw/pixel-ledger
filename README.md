# Pixel Ledger

以台灣繁體中文設計的個人記帳 PWA，使用 TanStack Start、Supabase 和 PostgreSQL。每個帳本使用 TWD、EUR 或 KRW，並可在設定切換帳本。韓國旅遊帳本使用手動輸入的 1 KRW 兌多少 TWD 匯率；每筆交易保留當時匯率與四捨五入至台幣分的估算。更改預設匯率只影響新交易，編輯舊交易沿用舊匯率。不提供即時匯率。EUR migration、上線順序及私人 Excel 匯入請見 [EUR 說明](docs/eur-rollout.md)。

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

資料表 `ledgers`、`transactions`、`categories`、`payment_methods` 的結構和 RLS 政策見 `drizzle/migrations/0000_pixel_ledger_m0.sql`，EUR 與 KRW 擴充見 `0001_eur_ledgers.sql` 和 `0002_krw_travel.sql`。每張表依 `auth.uid()` 限制資料存取；交易的複合外鍵要求帳本、分類與付款方式屬於相同使用者。預設帳本以部分唯一索引限制每位使用者最多一個。`ledger_report` 依帳本時區與 `occurred_at` 加總原幣金額，金額以 PostgreSQL numeric 與字串／整數分處理。EUR 不換算台幣，換算欄位留空。KRW 以資料庫 trigger 保存每筆匯率快照及台幣估算。正式使用前仍須驗證真實帳號與完整流程。

## iPhone 安裝與限制

部署 HTTPS 後在 iPhone Safari 開啟網址，點「分享」→「加入主畫面」，再從主畫面開啟。不支援離線新增或同步，也未實作推播提醒、旅遊期間管理及即時匯率查詢。

## 手動驗收清單

- 註冊、驗證郵件、登入、重設密碼；檢查預設帳本只建立一次。
- 新增、修改、刪除交易，重新整理後資料仍存在，報表立即更新。
- 台北午夜、跨月、零筆資料，以及分類／付款方式結算。
- 兩個帳號交叉讀取或引用對方資料必須被拒絕。
- 匯出 CSV 並在 Excel 驗證內容、中文及公式字元處理。
- iPhone Safari 的窄螢幕表單、鍵盤、加入主畫面與開啟。



## 紙本手帳與固定支出

- 全站使用淺色紙張、橫線與柔和分類色，不隨裝置切換深色。
- 交易補充說明選填，資料庫保存空字串，列表以分類名稱顯示。既有說明保留。CSV 的說明欄留空，分類另有欄位。
- 設定 → 固定支出：每月／每年，自選首次日期、金額、分類與付款方式。首次日期不得早於帳本當地今天。
- 只自動記帳，不會實際付款。每小時第 5 分鐘檢查，以帳本當地日期的 00:00 作為 occurred_at。App 不需開啟；資料庫停機／Free 專案暫停時不會執行，恢復後補記到期項目，每次每個規則最多 120 期。
- 31 日遇短月用月底，下個月仍回到原始日期；每年 2/29 在非閏年用 2/28。
- 暫停不記帳，恢復時跳過暫停期間。停止並移除設定保留已產生的交易；刪除已產生的交易不會再次補記。改金額或週期請停止舊設定並新增，首次日期須避免與已記帳期重疊。
- KRW 每次產生交易時保存當時帳本匯率；不是預先鎖定未來匯率。EUR 不換算 TWD。

部署順序：先套用 `drizzle/migrations/0004_recurring_expenses.sql`，再執行 `drizzle/recurring-cron.sql` 啟用 pg_cron 與排程，最後部署前端。沒有新環境變數，也不需要 service role key。Cron 在 private schema 的函式執行，前端無法呼叫；RLS 與複合外鍵隔離帳號，客戶端只能更新 enabled，不能倒退 next_date。產生交易及推進日期在同一 transaction，行鎖與唯一鍵避免重複。排程紀錄保留 14 天。

驗證：CI 的 `tests/db/recurring.sql` 使用 PostgreSQL 17 測試月末、閏年、時區、冪等、刪除後不重建、補記、暫停／恢復、停止保留交易及 RLS。測試全部回滾。另需人工在 iPhone 驗證淺色版面、分類＋金額無說明送出，以及建立真實固定支出後等待排程產生首筆；可在 Supabase Cron History 查排程狀態。

## 淺色風格主題

設定 → 外觀，可即時切換「紙本手帳」（預設）、「無印良品風」與「火影忍者風」。火影風保留淺色卷軸與橘色按鈕，右上角為曉組織的鼬。此為獨立設計的主題，沒有官方品牌或作品合作關係。

選擇保存在目前瀏覽器／PWA 的 localStorage（`pixel-ledger:appearance`），重新整理與重新開啟後保留，同源分頁也會更新。不跨裝置同步；Safari 與主畫面 PWA 若使用不同儲存空間，需各選一次。無痕模式、清除網站資料或禁止儲存時可能無法保留；即時切換仍可用，畫面會提示。沒有新增資料庫欄位、權限或環境變數。

SSR 一律輸出安全預設值；head 中的固定 allowlist script 在畫面顯示前套用已存主題，避免閃回預設色。三款都固定 light color scheme，財務資料與操作標籤不隨主題改變。裝飾不攔截觸控；鼬使用約 9 KB 的透明 WebP，無新增套件。

`src/test/appearance.test.tsx` 驗證三款切換、儲存／重掛載、跨分頁、非法儲存值、首次顯示與 Safari 儲存失敗處理。發布前跑 TypeScript、Vitest、Vercel build 及既有資料庫測試。iPhone 人工確認：設定依序切換三款，檢查首頁、新增、紀錄、報表；重新開啟 PWA 後保留；窄螢幕無橫向溢出，鼬不遮住標題或按鈕。iOS 主畫面圖示沿用原有 App icon，不隨主題更換。
