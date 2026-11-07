import type { Page } from 'playwright';
import { config } from './config';
import { normalizeStatus } from './scraper';
import type { RawRow } from './types';

const url = (p: string) => config.baseUrl + p;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------- Multiservices (/customer/getcustomermultiservices, DataTables) ----------
// The server ignores `length` and always returns 10 rows per request, however
// large a length we ask for (confirmed: length=1000 still returned 10 rows).
// So we page with a fixed size of 10 and fire requests in parallel — that's
// the actual speedup, not a bigger page size.
const MULTI_PAGE_SIZE = 10;

const MULTI_COLUMNS = [
  ['no', 'no', true, false], ['select', 'select', true, false],
  ['no_services', 'no_services', true, true], ['name', 'name', true, true],
  ['phone', 'phone', true, true], ['duedate', 'duedate', true, true],
  ['ppn', 'ppn', true, true], ['register_date', 'register_date', true, true],
  ['remark', 'remark', true, false], ['bill_month', 'bill_month', true, true],
  ['status', 'status', true, true], ['address', 'address', true, true],
  ['action', 'action', true, false],
] as const;

function multiBody(start: number, draw: number) {
  const p = new URLSearchParams();
  p.set('0[status]', ''); p.set('0[router]', ''); p.set('0[coverage]', '');
  p.set('draw', String(draw));
  MULTI_COLUMNS.forEach(([data, name, searchable, orderable], i) => {
    p.set(`columns[${i}][data]`, data);
    p.set(`columns[${i}][name]`, name);
    p.set(`columns[${i}][searchable]`, String(searchable));
    p.set(`columns[${i}][orderable]`, String(orderable));
    p.set(`columns[${i}][search][value]`, '');
    p.set(`columns[${i}][search][regex]`, 'false');
  });
  p.set('start', String(start));
  p.set('length', String(MULTI_PAGE_SIZE));
  p.set('search[value]', ''); p.set('search[regex]', 'false');
  return p.toString();
}

interface MultiPage { draw: string; recordsTotal: number; data: any[] }

async function fetchMultiPage(page: Page, start: number, draw: number): Promise<MultiPage> {
  const res = await page.context().request.post(url('/customer/getcustomermultiservices'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
    data: multiBody(start, draw),
  });
  if (!res.ok()) throw new Error(`Multiservices page failed: ${res.status()}`);
  return res.json();
}

function mapMultiRow(d: any): RawRow {
  return {
    name: d.name ?? '', number: d.no_services ?? '', numberRaw: d.no_services ?? '',
    method: '', bank: '', total: '',
    status: normalizeStatus(d.status ?? ''),
    contact: d.phone ?? '', amount: String(d.bill_month ?? ''), address: d.address ?? '',
  };
}

export async function fetchAllMultiservicesAjax(page: Page): Promise<{ rows: RawRow[]; warnings: string[] }> {
  const first = await fetchMultiPage(page, 0, 1);
  const total = first.recordsTotal;
  const rows: any[] = [...first.data];

  const starts: number[] = [];
  for (let s = MULTI_PAGE_SIZE; s < total; s += MULTI_PAGE_SIZE) starts.push(s);
  const pages = await mapLimit(starts, 3, (s) => fetchMultiPage(page, s, s / MULTI_PAGE_SIZE + 1));
  for (const p of pages) rows.push(...p.data);

  const warnings: string[] = [];
  if (rows.length !== total) warnings.push(`Multiservices: server reports ${total} rows but ${rows.length} were fetched.`);
  return { rows: rows.map(mapMultiRow), warnings };
}

// ---------- Bill (/pagination/getdata?endpoint=bill) ----------
// Same story: entries_per_page is ignored, server always returns 10 rows,
// but it does tell us the true page count via pagination.last_page.
async function fetchBillPage(page: Page, opts: { month: number; year: number; status: string; page: number }) {
  const qs = new URLSearchParams({
    endpoint: 'bill', page: String(opts.page), search: '', search_key: 'name',
    sort_by: 'name', sort_direction: 'asc', entries_per_page: '10',
    status: opts.status, coverage: '', month: String(opts.month), year: String(opts.year), method: '',
  });
  const res = await page.context().request.get(`${url('/pagination/getdata')}?${qs}`, {
    headers: { 'x-requested-with': 'XMLHttpRequest' },
  });
  if (!res.ok()) throw new Error(`Bill page failed: ${res.status()}`);
  return res.json() as Promise<{ data: any[]; pagination: { last_page: number; total_records: number } }>;
}

function mapBillRow(d: any): RawRow {
  return {
    name: d.name ?? '', number: d.no_services ?? '', numberRaw: d.no_services ?? '',
    method: d.payment_method ?? '', bank: '', total: String(d.amount ?? ''),
    status: normalizeStatus(d.status ?? ''),
    contact: d.phone ?? '', amount: String(d.amount ?? ''), address: d.address ?? '',
  };
}

export async function fetchAllBillsAjax(
  page: Page, year: number, month: number, only: 'all' | 'unpaid',
): Promise<{ rows: RawRow[]; warnings: string[] }> {
  const statusParam = only === 'unpaid' ? 'UNPAID' : '';
  const first = await fetchBillPage(page, { month, year, status: statusParam, page: 1 });
  const rows: any[] = [...first.data];
  const lastPage = first.pagination.last_page;

  if (lastPage > 1) {
    const pages = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);
    const batches = await mapLimit(pages, 3, (p) => fetchBillPage(page, { month, year, status: statusParam, page: p }));
    for (const b of batches) rows.push(...b.data);
  }

  const warnings: string[] = [];
  if (rows.length !== first.pagination.total_records) {
    warnings.push(`Bill ${month}/${year}: server reports ${first.pagination.total_records} rows but ${rows.length} were fetched.`);
  }
  return { rows: rows.map(mapBillRow), warnings };
}