# Status Fetcher

Type an Account Name or Account Number → get the **Status** from
`glercimor.com/customer/multiservices` and `glercimor.com/bill`
(Unpaid = UNVERIFIED, Paid = VERIFIED).

- React + TypeScript (client, Vite) · Node + Express + Playwright (server)
- No database. Everything is cached in server memory with no expiry
  (cleared only when you press **Refresh data** or restart the server).
- Export to Excel (.xlsx), CSV, or **Copy** (tab-separated, paste straight into Excel).

## Setup (VS Code terminal)

```bash
npm run install:all          # installs everything + Chromium for Playwright
cp server/.env.example server/.env   # then put your portal username/password in it
npm run dev                  # server :4000, client :5173
```
Open http://localhost:5173

## If a page isn't read correctly

The scraper finds filters and columns by label/header text. If the portal's
markup differs, run:

```bash
npm run inspect
```
It opens a visible browser, logs in, and prints every dropdown, input,
button and table header on both pages. Then adjust `server/src/config.ts`
(`columns` regexes or the optional CSS `selectors` overrides).
