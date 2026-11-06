import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from './config';
import type { RawRow } from './types';
import { fetchAllMultiservicesAjax, fetchAllBillsAjax } from './ajax';

const url = (p: string) => config.baseUrl + p;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------- session ----------
let browser: Browser | null = null;
let sessionPromise: Promise<BrowserContext> | null = null;

async function login(): Promise<BrowserContext> {
  if (!config.username || !config.password) {
    throw new Error('Set GLERCIMOR_USERNAME and GLERCIMOR_PASSWORD in server/.env');
  }
  browser ??= await chromium.launch({ headless: config.headless });
  const ctx = await browser.newContext();
  await ctx.route('**/*', (r) => ['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  await ctx.addInitScript('globalThis.__name = globalThis.__name || ((fn) => fn);');
  const page = await ctx.newPage();
  await page.goto(url(config.pages.login), { waitUntil: 'domcontentloaded' });
  await page
    .locator('input[type="email"], input[name*="email" i], input[name*="user" i], input[id*="user" i], input[id*="email" i], input[type="text"]')
    .first()
    .fill(config.username);
  await page.locator('input[type="password"]').first().fill(config.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith(config.pages.login), { timeout: 30_000 }),
    page
      .locator('button[type="submit"], input[type="submit"], button:has-text("Log"), button:has-text("Sign")')
      .first()
      .click(),
  ]).catch(() => {
    throw new Error('Login did not complete. Check the credentials in server/.env.');
  });
  await page.close();
  return ctx;
}

function getContext(): Promise<BrowserContext> {
  sessionPromise ??= login().catch((e) => {
    sessionPromise = null;
    throw e;
  });
  return sessionPromise;
}

async function resetSession() {
  const p = sessionPromise;
  sessionPromise = null;
  (await p?.catch(() => null))?.close().catch(() => {});
}

export async function openPage(path: string, retry = true): Promise<Page> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  await page.goto(url(path), { waitUntil: 'networkidle' });
  if (new URL(page.url()).pathname.startsWith(config.pages.login)) {
    await page.close();
    if (!retry) throw new Error('Session expired and re-login failed.');
    await resetSession();
    return openPage(path, false);
  }
  return page;
}

// ---------- filters ----------
interface Opt { label: string; value: string }
interface SelectInfo { hint: string; options: Opt[] }

const settle = async (page: Page) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
};

async function describeSelects(page: Page, css: string): Promise<SelectInfo[]> {
  return page.$$eval(css, (els) =>
    els.map((el) => {
      const s = el as HTMLSelectElement;
      const short = (t: string | null | undefined) => {
        const x = (t ?? '').replace(/\s+/g, ' ').trim();
        return x.length <= 30 ? x : '';
      };
      const byFor = s.id ? short(document.querySelector(`label[for="${s.id}"]`)?.textContent) : '';
      const prev = short(s.previousElementSibling?.textContent);
      return {
        hint: [s.name, s.id, s.getAttribute('aria-label'), byFor, prev].filter(Boolean).join(' '),
        options: Array.from(s.options).map((o) => ({ label: o.text.trim(), value: o.value })),
      };
    }),
  );
}

// The portal fills some dropdowns after the page loads, so wait until the options exist.
async function waitForOptions(page: Page, css: string) {
  await page.waitForSelector(css, { state: 'attached', timeout: 15_000 }).catch(() => {});
  await page
    .waitForFunction((sel) => ((document.querySelector(sel) as HTMLSelectElement | null)?.options.length ?? 0) > 1, css, { timeout: 15_000 })
    .catch(() => {});
}

async function optionsOf(page: Page, css: string): Promise<string> {
  const info = (await describeSelects(page, css))[0];
  return info ? info.options.map((o) => `${o.label}=${o.value}`).join(', ') : 'dropdown not found';
}

async function chooseOption(
  page: Page,
  hint: RegExp,
  pick: (o: Opt[]) => Opt | undefined,
  override?: string,
): Promise<boolean> {
  const css = override ?? 'select';
  if (override) await waitForOptions(page, override);
  const infos = await describeSelects(page, css);
  const idx = override ? 0 : infos.findIndex((i) => hint.test(i.hint));
  const info = infos[idx];
  if (!info) return false;
  const opt = pick(info.options);
  if (!opt) return false;
  await page.locator(css).nth(idx).selectOption({ value: opt.value }, { force: true, timeout: 5000 });
  await settle(page);
  return true;
}

const pickAll = (o: Opt[]) =>
  o.find((x) => /^\s*all\b/i.test(x.label)) ?? o.find((x) => x.value === '' || /^all$/i.test(x.value));

async function submitFilters(page: Page) {
  const btn = page.getByRole('button', { name: /^\s*(filter|search|apply|show|go|submit)\s*$/i }).first();
  if (await btn.count()) await btn.click().catch(() => {});
  await settle(page);
}

const monthWord = (label: string) =>
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(label.replace(/^\d+\s*[-.)]?\s*/, '').trim());
const isYearOpt = (o: Opt) => /^(19|20)\d\d$/.test(o.label.trim()) || /^(19|20)\d\d$/.test(o.value.trim());

function pickMonth(o: Opt[], month: number): Opt | undefined {
  const full = MONTHS[month - 1].toLowerCase();
  return (
    o.find((x) => x.label.trim().toLowerCase() === full) ??
    o.find((x) => x.label.trim().toLowerCase().startsWith(full)) ??
    o.find((x) => x.value.trim() !== '' && Number(x.value) === month) ??
    o.find((x) => x.label.toLowerCase().includes(full.slice(0, 3)))
  );
}

async function selectAt(page: Page, css: string, idx: number, value: string) {
  await page.locator(css).nth(idx).selectOption({ value }, { force: true, timeout: 5000 });
  await settle(page);
}

async function describeControls(page: Page): Promise<string> {
  const info = await page.evaluate(() => ({
    selects: Array.from(document.querySelectorAll('select')).map((s) => ({
      name: s.name, id: s.id, options: Array.from(s.options).slice(0, 5).map((o) => o.text.trim()),
    })),
    inputs: Array.from(document.querySelectorAll('input')).map((i) => `${i.type}|${i.name}|${i.id}|${i.placeholder}`),
    buttons: Array.from(document.querySelectorAll('button, a.btn, input[type=submit]')).map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 15),
  }));
  return JSON.stringify(info).slice(0, 1800);
}

async function tryPeriod(page: Page, year: number, month: number): Promise<boolean> {
  const mm = String(month).padStart(2, '0');
  const abbr = MONTHS[month - 1].slice(0, 3).toLowerCase();

  // explicit overrides from config.ts
  if (config.selectors.billMonth && config.selectors.billYear) {
    const m = await chooseOption(page, /month/i, (o) => pickMonth(o, month), config.selectors.billMonth);
    const y = await chooseOption(page, /year/i, (o) => o.find((x) => x.label.trim() === String(year) || x.value === String(year)), config.selectors.billYear);
    return m && y;
  }

  const infos = await describeSelects(page, 'select');

  // one dropdown with combined options such as "September 2026" or "2026-09"
  for (let i = 0; i < infos.length; i++) {
    const opt = infos[i].options.find(
      (o) =>
        (o.label.toLowerCase().includes(abbr) && o.label.includes(String(year))) ||
        [`${year}-${mm}`, `${mm}-${year}`, `${mm}/${year}`, `${year}/${mm}`].includes(o.value.trim()),
    );
    if (opt) return await selectAt(page, 'select', i, opt.value), true;
  }

  // separate month and year dropdowns, found by label OR by what their options contain
  const mi = infos.findIndex((i) => /month/i.test(i.hint) || i.options.filter((o) => monthWord(o.label)).length >= 6);
  const yi = infos.findIndex((i) => /year/i.test(i.hint) || i.options.filter(isYearOpt).length >= 2);
  if (mi >= 0 && yi >= 0 && mi !== yi) {
    const mo = pickMonth(infos[mi].options, month);
    const yo = infos[yi].options.find((o) => o.label.trim() === String(year) || o.value.trim() === String(year));
    if (mo && yo) {
      await selectAt(page, 'select', mi, mo.value);
      await selectAt(page, 'select', yi, yo.value);
      return true;
    }
  }

  const monthInput = page.locator('input[type="month"]').first();
  if (await monthInput.count()) return await monthInput.fill(`${year}-${mm}`), true;

  const dates = page.locator('input[type="date"]');
  if ((await dates.count()) >= 2) {
    await dates.nth(0).fill(`${year}-${mm}-01`);
    await dates.nth(1).fill(`${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`);
    return true;
  }
  return false;
}

async function setPeriod(page: Page, year: number, month: number) {
  if (await tryPeriod(page, year, month)) return;
  // filters may be hidden behind a "Filter" button / panel
  const toggle = page.getByRole('button', { name: /filter/i }).first();
  if (await toggle.count()) {
    await toggle.click().catch(() => {});
    await settle(page);
    if (await tryPeriod(page, year, month)) return;
  }
  if (config.selectors.billMonth && config.selectors.billYear) {
    throw new Error(
      `Could not set ${MONTHS[month - 1]} ${year} on /bill. ` +
        `${config.selectors.billMonth} options: [${await optionsOf(page, config.selectors.billMonth)}]. ` +
        `${config.selectors.billYear} options: [${await optionsOf(page, config.selectors.billYear)}].`,
    );
  }
  throw new Error(
    'Could not find the month/year controls on /bill. Controls found on the page: ' +
      (await describeControls(page)) +
      ' -- send this to the developer, or set selectors in server/src/config.ts.',
  );
}

// ---------- table reading ----------
interface TableData { headers: string[]; rows: string[][] }

async function readTable(page: Page): Promise<TableData> {
  await page.waitForSelector('table tbody tr', { timeout: 15_000 }).catch(() => {});
  const tables: TableData[] = await page.$$eval('table', (ts) =>
    ts.map((t) => {
      const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      let headers = Array.from(t.querySelectorAll('thead th, thead td')).map((c) => clean(c.textContent));
      if (!headers.length) headers = Array.from(t.querySelectorAll('tr:first-child th')).map((c) => clean(c.textContent));
      const rows = Array.from(t.querySelectorAll('tbody tr'))
        .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => clean(td.textContent)))
        .filter((cells) => cells.length > 1);
      return { headers, rows };
    }),
  );
  const best = tables.filter((t) => t.headers.length).sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!best) throw new Error('No data table found on the page.');
  return best;
}

interface RunInfo {
  total: number;
  pages: number;
  stop: string;
  size: string;
  lastPageRows: number;
  headers: string[];
  missing: string[];
  methodMissing: boolean;
  methodHeader: string;
  bankHeader: string;
  totalHeader: string;
  pageSize: number;
}

const tableCount = (page: Page) =>
  page.evaluate(() => Math.max(0, ...Array.from(document.querySelectorAll('table')).map((t) => t.querySelectorAll('tbody tr').length)));

// Wait until the table shows `want` rows, or stops growing (the portal can be slow to redraw 1000 rows).
async function waitForRows(page: Page, want: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  let prev = -1;
  let same = 0;
  while (Date.now() < end) {
    const n = await tableCount(page);
    if (n >= want) return true;
    same = n === prev ? same + 1 : 0;
    prev = n;
    if (same >= 6 && n > 10) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function maximisePageSize(page: Page, info: RunInfo) {
  const infos = await describeSelects(page, 'select');
  const has = (i: SelectInfo, v: string) => i.options.some((o) => o.value.trim() === v || o.label.trim() === v);
  let idx = infos.findIndex((i) => /length|entries|per.?page|limit/i.test(i.hint) && !/search|category/i.test(i.hint));
  if (idx < 0) idx = infos.findIndex((i) => ['10', '25', '50', '100'].every((v) => has(i, v)));
  if (idx < 0) return;
  if (info.total > 0 && info.total <= 10) return; // everything already fits on one page
  const opts = infos[idx].options;
  const allOpt = opts.find((o) => /^\s*all\s*$/i.test(o.label) || o.value === '-1');
  const biggest = opts
    .filter((o) => /^\d+$/.test(o.value.trim()) && Number(o.value) <= 1000)
    .sort((x, y) => Number(y.value) - Number(x.value))[0];
  const pick = allOpt ?? biggest;
  if (!pick) return;
  info.size = pick.label || pick.value;
  info.pageSize = allOpt ? Infinity : Number(pick.value);
  const cap = info.total || Infinity;
  const want = allOpt ? cap : Math.min(Number(pick.value), cap);

  const loc = page.locator('select').nth(idx);
  await loc.selectOption({ value: pick.value }, { force: true, timeout: 5000 }).catch(() => {});
  if (!(await waitForRows(page, want, 15_000))) {
    // some pages only react to jQuery's change event
    await loc
      .evaluate((el, v) => {
        const sel = el as HTMLSelectElement;
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const jq = (window as any).jQuery;
        if (jq) jq(sel).trigger('change');
      }, pick.value)
      .catch(() => {});
    await waitForRows(page, want, info.total ? 90_000 : 20_000);
  }
  await settle(page);
}

// "011900302020124 ( 1716470574)" and "011900302020124" are the same account
const stripParen = (s: string) => s.replace(/\s*\(.*$/, '').trim();

export function normalizeStatus(raw: string): string {
  const k = raw.trim().toUpperCase();
  return config.statusMap[k] ?? (k || '—');
}

const NEXT = [
  '.paginate_button.next:not(.disabled)',
  'li.page-item.next:not(.disabled) a',
  'li.next:not(.disabled) a',
  'a[rel="next"]',
  'button:has-text("Next"):not([disabled])',
  'li:not(.disabled) > a:has-text("Next")',
  '.pagination li:not(.disabled) a:has-text("›")',
  '.pagination li:not(.disabled) a:has-text("»")',
  '.pagination li:not(.disabled) a:has-text(">")',
  '.pagination li.active + li:not(.disabled) a',
  '.pagination li.active + li:not(.disabled) button',
  'li.active + li:not(.disabled) a',
  'a.active + a',
  'span.current + a',
  'button.active + button',
  'a.next:not(.disabled)',
].join(', ');

const TOTAL_RE = /of\s+([\d,]+)\s+(?:entries|records|results|rows)/i;

const SHOWING_RE = /showing\s+[\d,]+\s+to\s+[\d,]+\s+of\s+([\d,]+)/gi;

async function reportedTotal(page: Page): Promise<number> {
  const text = await page.locator('body').innerText().catch(() => '');
  const nums = [...text.matchAll(SHOWING_RE)].map((m) => Number(m[1].replace(/,/g, '')));
  if (nums.length) return Math.max(...nums);
  const m = text.match(TOTAL_RE);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}

const sigOf = (t: TableData) =>
  `${t.rows.length}|${t.rows[0]?.join('|') ?? ''}|${t.rows[t.rows.length - 1]?.join('|') ?? ''}`;

// After clicking "next", wait (up to 90s) until the table shows different rows. False = it never changed.
async function waitTableChange(page: Page, prev: string): Promise<boolean> {
  for (let i = 0; i < 130; i++) {
    await page.waitForTimeout(700);
    const t = await readTable(page).catch(() => null);
    if (t && sigOf(t) !== prev) return true;
  }
  return false;
}

// Redrawing 1000 rows takes a moment: wait for the expected row count, or until it stops changing.
async function waitStable(page: Page, want: number) {
  let prev = -1;
  let same = 0;
  for (let i = 0; i < 80; i++) {
    const n = await tableCount(page).catch(() => -1);
    if (want > 0 && n >= want) return;
    same = n === prev ? same + 1 : 0;
    prev = n;
    if (same >= 3 && n > 1) return;
    await page.waitForTimeout(600);
  }
}

async function readAllRows(page: Page, wantMethod = false, wantAccount = false): Promise<{ rows: RawRow[]; info: RunInfo }> {
  const info: RunInfo = {
    total: await reportedTotal(page), pages: 0, stop: 'loop ended', size: '', lastPageRows: 0,
    headers: [], missing: [], methodMissing: false, methodHeader: '', bankHeader: '', totalHeader: '', pageSize: 0,
  };
  const rowsNow = await tableCount(page).catch(() => 0);
  if (info.total && info.total < rowsNow) info.total = 0; // impossible, so the number is wrong: ignore it
  await maximisePageSize(page, info);
  const out: RawRow[] = [];
  const seenPages = new Set<string>();

  for (let i = 0; i < 2000; i++) {
    const remaining = info.total ? info.total - out.length : 0;
    await waitStable(page, remaining > 0 && info.pageSize > 0 ? Math.min(info.pageSize, remaining) : 0);

    const t = await readTable(page);
    const nameIdx = t.headers.findIndex((h) => config.columns.name.test(h));
    const col = {
      name: nameIdx,
      number: t.headers.findIndex((h, k) => k !== nameIdx && config.columns.number.test(h)),
      status: t.headers.findIndex((h) => config.columns.status.test(h)),
    };
    if (col.status < 0 || (col.name < 0 && col.number < 0)) {
      throw new Error(`Unexpected table columns: [${t.headers.join(' | ')}]. Adjust "columns" in server/src/config.ts.`);
    }
    const taken = [col.name, col.number, col.status];
    const methodIdx = wantMethod ? t.headers.findIndex((h, k) => !taken.includes(k) && config.columns.method.test(h)) : -1;
    const bankIdx = wantMethod
      ? t.headers.findIndex((h, k) => !taken.includes(k) && k !== methodIdx && config.columns.bank.test(h))
      : -1;
    const totalIdx = wantMethod
      ? t.headers.findIndex((h, k) => !taken.includes(k) && k !== methodIdx && k !== bankIdx && config.columns.total.test(h))
      : -1;
      const extra = (re: RegExp, used: number[]) => wantAccount ? t.headers.findIndex((h, k) => !used.includes(k) && re.test(h)) : -1;
const contactIdx = extra(config.columns.contact, taken);
const amountIdx = extra(config.columns.amount, [...taken, contactIdx]);
const addressIdx = extra(config.columns.address, [...taken, contactIdx, amountIdx]);
    info.methodMissing = wantMethod && methodIdx < 0 && bankIdx < 0;
    info.methodHeader = methodIdx >= 0 ? t.headers[methodIdx] : '';
    info.bankHeader = bankIdx >= 0 ? t.headers[bankIdx] : '';
    info.totalHeader = totalIdx >= 0 ? t.headers[totalIdx] : '';
    info.headers = t.headers;
    info.missing = [col.name < 0 ? 'account name' : '', col.number < 0 ? 'account number' : ''].filter(Boolean);

    const signature = sigOf(t);
    if (!seenPages.has(signature)) {
      seenPages.add(signature);
      info.pages++;
      info.lastPageRows = t.rows.length;
      for (const r of t.rows) {
        out.push({
          name: col.name >= 0 ? r[col.name] ?? '' : '',
          number: col.number >= 0 ? stripParen(r[col.number] ?? '') : '',
          method: methodIdx >= 0 ? r[methodIdx] ?? '' : '',
          bank: bankIdx >= 0 ? r[bankIdx] ?? '' : '',
          total: totalIdx >= 0 ? r[totalIdx] ?? '' : '',
          status: normalizeStatus(r[col.status] ?? ''),
          numberRaw: col.number >= 0 ? r[col.number] ?? '' : '',
contact: contactIdx >= 0 ? r[contactIdx] ?? '' : '',
amount: amountIdx >= 0 ? r[amountIdx] ?? '' : '',
address: addressIdx >= 0 ? r[addressIdx] ?? '' : '',
        });
      }
    }
    if (info.total && out.length > info.total) info.total = 0; // total was wrong, rely on the Next button
    if (info.total && out.length >= info.total) {
      info.stop = 'reached the reported total';
      break;
    }

    const next = page.locator(`${NEXT} >> visible=true`).first();
    if (!(await next.count())) {
      info.stop = 'no Next button found';
      break;
    }
    if ((await next.getAttribute('aria-disabled')) === 'true') {
      info.stop = 'Next button disabled';
      break;
    }
    // Redrawing a big table can freeze the page for several seconds: a slow click is not a failed click.
    let clicked = true;
    try {
      await next.click({ timeout: 30_000, noWaitAfter: true });
    } catch {
      clicked = false;
    }
    if (!(await waitTableChange(page, signature))) {
      info.stop = clicked ? 'the table did not change after clicking Next' : 'Next button could not be clicked';
      break;
    }
  }
  return { rows: out, info };
}

// Warn when rows are missing or columns could not be identified, with details to fix it.
async function report(page: Page, label: string, rows: RawRow[], info: RunInfo, warnings: string[], quiet = false) {
  if (info.missing.length) {
    warnings.push(`${label}: no ${info.missing.join(' / ')} column found. Table columns: [${info.headers.join(' | ')}]`);
  }
  if (info.methodMissing) {
    warnings.push(`${label}: no payment method column found, so Remark will be blank. Table columns: [${info.headers.join(' | ')}]`);
  }
  if (!quiet && (info.methodHeader || info.bankHeader || info.totalHeader)) {
    const seen = new Map<string, number>();
    let unpaidWithValue = 0;
    for (const r of rows) {
      const v = [r.bank, r.method].map((x) => x.trim()).filter(Boolean).join(' / ');
      if (!v) continue;
      if (r.status === 'UNVERIFIED') unpaidWithValue++;
      seen.set(v, (seen.get(v) ?? 0) + 1);
    }
    const top = [...seen].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([v, n]) => `${v} (${n})`).join(', ') || 'none';
    warnings.push(
      `Bill remark source: method column "${info.methodHeader || '-'}", bank column "${info.bankHeader || '-'}", total column "${info.totalHeader || '-'}". Values seen: ${top}. Unpaid rows that have a value (ignored): ${unpaidWithValue}.`,
    );
  }
  if (info.total && info.total !== rows.length) {
    const html = await page
      .locator('.dataTables_paginate, ul.pagination')
      .locator('visible=true')
      .first()
      .evaluate((el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 700))
      .catch(() => 'no pagination element found');
    warnings.push(
      `${label}: the page reports ${info.total} rows but ${rows.length} were read. Read ${info.pages} pages (page size: ${info.size || 'not changed'}, last page had ${info.lastPageRows} rows), stopped because: ${info.stop}. Pagination markup: ${html}`,
    );
  }
}

// ---------- public fetchers ----------
export interface Fetched { rows: RawRow[]; warnings: string[] }

 export async function fetchMultiservices(): Promise<Fetched> {
   const page = await openPage(config.pages.multiservices);
   try {
    return await fetchAllMultiservicesAjax(page);
  } catch (e) {
   console.warn('AJAX multiservices fetch failed, falling back to UI scrape:', e);
   const warnings: string[] = [];
     const ok = await chooseOption(page, /status/i, pickAll, config.selectors.multiStatus);
     if (!ok) warnings.push('Multiservices: status filter not found, so "All" could not be set.');
     await submitFilters(page);
     const { rows, info } = await readAllRows(page, false, true);
     await report(page, 'Multiservices', rows, info, warnings);
     return { rows, warnings };
   } finally {
     await page.close();
   }
 }

 export async function fetchBills(year: number, month: number, only: 'all' | 'unpaid' = 'all'): Promise<Fetched> {
   const page = await openPage(config.pages.bill);
   try {
    return await fetchAllBillsAjax(page, year, month, only);
  } catch (e) {
    console.warn('AJAX bill fetch failed, falling back to UI scrape:', e);
    const warnings: string[] = [];
     await setPeriod(page, year, month);
     const pickUnpaid = (o: Opt[]) => o.find((x) => /^\s*unpaid\b/i.test(x.label));
     const ok = await chooseOption(page, /status/i, only === 'unpaid' ? pickUnpaid : pickAll, config.selectors.billStatus);
     const label = only === 'unpaid' ? `Bill ${MONTHS[month - 1]} ${year}` : 'Bill';
     if (!ok) warnings.push(`${label}: status filter not found, so "${only === 'unpaid' ? 'Unpaid' : 'All'}" could not be set.`);
     await submitFilters(page);
     const { rows, info } = await readAllRows(page, true);
     await report(page, label, rows, info, warnings, only === 'unpaid');
     return { rows, warnings };
   } finally {
     await page.close();
   }
 }

export async function closeBrowser() {
  await browser?.close();
}