import type { RawRow, ResultRow, UnpaidRow } from './types';
import { accountNumberMatches } from './accountNumber';

const stripParen = (s: string) => s.replace(/\s*\(.*$/, '').trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Account number: exact match (ignoring dashes/spaces). Name: every typed word
// must appear in the account name, in any order.
 function matches(query: string, r: RawRow): boolean {
   const nq = norm(query);
   if (!nq) return false;
  if (r.number && accountNumberMatches(stripParen(query), r.number)) return true;
   const nameWords = tokens(r.name).join(' ');
   const qt = tokens(query);
   return qt.length > 0 && qt.every((t) => nameWords.includes(t));
 }

// Remark from the Bill payment details. Unpaid rows never get one (blank method = unpaid).
const BLANK = /^[\s\-–—.]*$|^(n\/?a|none|null|nil|unpaid)$/i;

const isZero = (s: string) => {
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) && n === 0;
};

function remarkOf(r: RawRow): string {
  if (isZero(r.total)) return 'FREE'; // total of 0 = free, whatever the status
  if (r.status === 'UNVERIFIED') return '';
  const method = BLANK.test(r.method.trim()) ? '' : r.method.trim();
  const bank = BLANK.test(r.bank.trim()) ? '' : r.bank.trim();
  const all = `${method} ${bank}`.trim();
  if (!all) return '';
  const label = (bank || method).toUpperCase();
  if (/g\s*-?\s*cash/i.test(all)) return `BANK PAYMENT - ${label}`; // GCash contains "cash"
  if (/\bcash\b/i.test(all)) return 'CASH PAYMENT';
  return `BANK PAYMENT - ${label}`;
}

const remarkFor = (rows: RawRow[]) => [...new Set(rows.map(remarkOf).filter(Boolean))].join(' / ');

function summarise(rows: RawRow[], empty: string): { status: string; detail: string } {
  if (rows.length === 0) return { status: empty, detail: '' };
  const verified = rows.filter((r) => r.status === 'VERIFIED').length;
  const allKnown = rows.every((r) => r.status === 'VERIFIED' || r.status === 'UNVERIFIED');
  const status = !allKnown
    ? [...new Set(rows.map((r) => r.status))].join(' / ')
    : verified === rows.length
      ? 'VERIFIED'
      : 'UNVERIFIED'; // any unpaid record => UNVERIFIED
  // only mention counts when the records disagree
  const detail = allKnown && verified > 0 && verified < rows.length ? `${verified} of ${rows.length} verified` : '';
  return { status, detail };
}

export function buildResults(multi: RawRow[], bills: RawRow[], query: string): Omit<ResultRow, 'query' | 'matched'>[] {
  const keyOf = (r: RawRow) => norm(r.number) || norm(r.name);
  const accounts = new Map<string, { name: string; number: string; multi: RawRow[]; bills: RawRow[] }>();

  const add = (r: RawRow, kind: 'multi' | 'bills') => {
    if (!matches(query, r)) return;
    const k = keyOf(r);
    const acc = accounts.get(k) ?? { name: r.name, number: r.number, multi: [], bills: [] };
    if (!acc.name) acc.name = r.name;
    if (!acc.number) acc.number = r.number;
    acc[kind].push(r);
    accounts.set(k, acc);
  };
  multi.forEach((r) => add(r, 'multi'));
  bills.forEach((r) => add(r, 'bills'));

  return [...accounts.values()]
    .map((a) => {
      const m = summarise(a.multi, 'NOT FOUND');
      const b = summarise(a.bills, 'NO BILL');
      return {
        accountName: a.name,
        accountNumber: a.number,
        multiservicesStatus: m.status,
        multiservicesDetail: m.detail,
        billStatus: b.status,
        billDetail: b.detail,
        remark: remarkFor(a.bills),
      };
    })
    .sort((x, y) => x.accountName.localeCompare(y.accountName));
}

// One input line = one query. Lines with no match still get a row so nothing is silently dropped.
export function buildAll(multi: RawRow[], bills: RawRow[], queries: string[]): ResultRow[] {
  return queries.flatMap((q): ResultRow[] => {
    const found = buildResults(multi, bills, q);
    if (found.length === 0) {
      return [{
        query: q, matched: false, accountName: '', accountNumber: '',
        multiservicesStatus: 'NOT FOUND', multiservicesDetail: '', billStatus: 'NOT FOUND', billDetail: '', remark: '',
      }];
    }
    return found.map((r) => ({ ...r, query: q, matched: true }));
  });
}

// All unpaid bills of the accounts matching each input line.
// Several accounts may share a name (all are listed), but each account gets one row per month.
export function buildUnpaid(
  multi: RawRow[],
  periods: { year: number; month: number; rows: RawRow[] }[], // oldest first
  queries: string[],
): UnpaidRow[] {
  const keyOf = (r: RawRow) => norm(r.number) || norm(r.name);
  const isUnpaid = (r: RawRow) => r.status === 'UNVERIFIED';

  return queries.flatMap((q): UnpaidRow[] => {
    const accounts = new Map<string, { name: string; number: string }>();
    const consider = (r: RawRow) => {
      const k = keyOf(r);
      if (k && matches(q, r) && !accounts.has(k)) accounts.set(k, { name: r.name, number: r.number });
    };
    multi.forEach(consider);
    periods.forEach((p) => p.rows.filter(isUnpaid).forEach(consider));

    if (accounts.size === 0) {
      return [{ query: q, accountName: '', accountNumber: '', month: 0, year: 0, total: '', note: 'NOT FOUND' }];
    }

    const out: UnpaidRow[] = [];
    const sorted = [...accounts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
    for (const [key, acc] of sorted) {
      let any = false;
      for (const p of periods) {
        const hit = p.rows.find((r) => isUnpaid(r) && keyOf(r) === key); // one per month
        if (!hit) continue;
        any = true;
        out.push({
          query: q,
          accountName: acc.name || hit.name,
          accountNumber: acc.number || hit.number,
          month: p.month,
          year: p.year,
          total: hit.total,
          note: '',
        });
      }
      if (!any) {
        out.push({ query: q, accountName: acc.name, accountNumber: acc.number, month: 0, year: 0, total: '', note: 'NO UNPAID BILLS' });
      }
    }
    return out;
  });
}
