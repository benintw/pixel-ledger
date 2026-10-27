# Pixel Ledger

Build a real working full-stack iPhone-first PWA named Pixel Ledger, in Traditional Chinese Taiwan (zh-TW), timezone Asia/Taipei. No marketing landing page. Single-user personal expenses, pixel-art Game Boy style: warm cream, sage, lavender, charcoal, readable sans-serif financial inputs, pixel headings, safe-area bottom navigation and large accessible controls.

Implement M0: email/password signup/signin, email verification and account recovery, route protection. Persistent Lovable Cloud PostgreSQL with RLS per user, database-enforced ownership of every referenced ledger, category and payment method. Create default 日常生活 ledger exactly once per user with robust uniqueness. Initial categories 餐飲、交通、購物、娛樂、生活用品、帳單、住宿、健康、其他 and methods 現金、信用卡、金融卡、行動支付、轉帳、其他, user-manageable in settings.

Schema: ledgers id,user_id,name,type daily/travel,base_currency,timezone,start_date,end_date,created_at. transactions id,user_id,ledger_id,description,category_id,payment_method_id,original_amount numeric(18,2),original_currency,amount_twd numeric(18,2),exchange_rate_to_twd numeric(20,10),occurred_at timestamptz,notes,created_at,updated_at. Categories and payment methods have id,user_id,name,created_at. Include indexes, foreign keys and checks. M0 TWD only, rate 1 and matching amounts enforced. Use exact decimal or integer minor-unit arithmetic end-to-end, not floating point. Preserve schema for future travel and KRW; do not implement conversion.

Routes: / today dashboard with date, today total, count, month total, newest transactions, 日常生活 and prominent +記一筆; /add form with description, positive amount, date/time default now, required payment method remembering last choice on device, category default 其他 and optional notes, validation, duplicate-submit prevention, errors, unsaved changes protection; /history search and date/category/payment filters, edit and confirmed delete; /reports daily date selector, totals/count/category/payment breakdown and list, monthly month selector, totals/daily average/count/category/payment breakdown and daily bar chart; /settings account, timezone, manage categories/payment methods, CSV export actual records, signout. All totals derived from stored occurred_at in ledger timezone, not created_at, update after CRUD, zero day works. CSV safe escaping and usable in Excel Traditional Chinese.

PWA manifest, standalone, portrait, pixel app icons and service worker, iPhone Safari Add to Home Screen. Do not claim offline transaction entry or sync. No reminders or KRW features yet. README with schema, security policies, env vars, setup, limitations and manual tests. Test signup/default ledger, CRUD persistence/refresh, daily/monthly totals and midnight timezone boundaries, user isolation RLS, CSV, responsive iPhone form. Be honest about any untested functionality and blockers. Build actual complete app, not mock data or a static prototype.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4cab4b2f-a047-49f1-9d9b-bef8dbb1069d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
