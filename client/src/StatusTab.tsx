import { useMemo, useRef, useState } from 'react';
import { checkUnpaid, lookup } from './api';
import {
  copyColumn,
  copyForExcel,
  copyTable,
  downloadCsv,
  downloadCsvTable,
  downloadXlsx,
  downloadXlsxTable,
  monthName,
} from './exporters';
import type { LookupResponse, ResultRow, UnpaidResponse, UnpaidRow } from './types';

interface Col<T> {
  key: string;
  label: string;
  get: (r: T) => string;
}

const COLUMNS: Col<ResultRow>[] = [
  { key: 'query', label: 'Searched', get: (r) => r.query },
  { key: 'name', label: 'Account name', get: (r) => r.accountName },
  { key: 'number', label: 'Account no.', get: (r) => r.accountNumber },
  { key: 'multi', label: 'Multiservices', get: (r) => r.multiservicesStatus },
  { key: 'bill', label: 'Bill', get: (r) => r.billStatus },
  { key: 'remark', label: 'Remark', get: (r) => r.remark },
];

const UNPAID_COLUMNS: Col<UnpaidRow>[] = [
  { key: 'query', label: 'Searched', get: (r) => r.query },
  { key: 'name', label: 'Account name', get: (r) => r.accountName },
  { key: 'number', label: 'Account no.', get: (r) => r.accountNumber },
  { key: 'month', label: 'Month', get: (r) => (r.month ? monthName(r.month) : '') },
  { key: 'year', label: 'Year', get: (r) => (r.year ? String(r.year) : '') },
  { key: 'total', label: 'Total', get: (r) => r.total },
  { key: 'note', label: 'Note', get: (r) => r.note },
];

// Default period = the past month (in January that is December of last year).
function defaultPeriod() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

const badgeClass = (s: string) =>
  s === 'VERIFIED' ? 'badge ok' : s === 'UNVERIFIED' ? 'badge bad' : 'badge neutral';

const time = (ms: number) => new Date(ms).toLocaleString();
const LOOKBACKS = [3, 6, 12, 24, 36];

export default function StatusTab() {
  const initial = useMemo(defaultPeriod, []);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  const [text, setText] = useState('');
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);
  const [lookBack, setLookBack] = useState(12);
  const [view, setView] = useState<'status' | 'unpaid'>('status');
  const [data, setData] = useState<LookupResponse | null>(null);
  const [unpaid, setUnpaid] = useState<UnpaidResponse | null>(null);
  const [loading, setLoading] = useState<'' | 'status' | 'unpaid'>('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const copyTimer = useRef<number>();
  const lines = () => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lineCount = lines().length;

  async function runStatus(refresh = false) {
    const queries = lines();
    if (!queries.length) return setError('Enter at least one account name or account number.');
    setLoading('status');
    setError('');
    try {
      setData(await lookup(queries, month, year, refresh));
      setView('status');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading('');
    }
  }

  async function runUnpaid(refresh = false) {
    const queries = lines();
    if (!queries.length) return setError('Enter at least one account name or account number.');
    setLoading('unpaid');
    setError('');
    try {
      setUnpaid(await checkUnpaid(queries, month, year, lookBack, refresh));
      setView('unpaid');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading('');
    }
  }

  function flash(key: string) {
    setCopied(key);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(''), 1800);
  }

  const cacheNote = data
    ? data.fromCache.multiservices && data.fromCache.bill
      ? `Served from cache. Last fetched ${time(Math.min(data.fetchedAt.multiservices, data.fetchedAt.bill))}.`
      : 'Fetched live from glercimor.com and cached.'
    : '';

  const unpaidTable = (u: UnpaidResponse) => [UNPAID_COLUMNS.map((c) => c.label), ...u.rows.map((r) => UNPAID_COLUMNS.map((c) => c.get(r)))];
  const unpaidStem = (u: UnpaidResponse) => {
    const last = u.periods[u.periods.length - 1];
    return `unpaid-${last.year}-${String(last.month).padStart(2, '0')}`;
  };

  return (
    <main>
      <h1>Status Fetcher</h1>
      <p className="lede">Check whether an account is verified in Multiservices and Bill, or list its unpaid bills.</p>

      <form
        className="controls"
        onSubmit={(e) => {
          e.preventDefault();
          void runStatus(false);
        }}
      >
        <label className="grow">
          Account names or numbers, one per line ({lineCount})
          <textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Dela Cruz Juan\n100234\nSantos Maria'}
            autoFocus
          />
        </label>
        <label>
          Month
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>{monthName(i + 1)}</option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <button type="submit" className="primary" disabled={!!loading}>
          {loading === 'status' ? 'Fetching…' : 'Fetch status'}
        </button>
        <label>
          Unpaid look-back
          <select className="lookback" value={lookBack} onChange={(e) => setLookBack(Number(e.target.value))}>
            {LOOKBACKS.map((n) => <option key={n} value={n}>{n} months</option>)}
          </select>
        </label>
        <button type="button" className="secondary" disabled={!!loading} onClick={() => void runUnpaid(false)}>
          {loading === 'unpaid' ? 'Checking…' : 'Check Unpaid'}
        </button>
      </form>

      {loading === 'status' && <p className="note">Reading the portal. The first lookup logs in and loads every page of results, so it can take a minute. Later lookups use the cache.</p>}
      {loading === 'unpaid' && <p className="note">Reading unpaid bills month by month, ending at {monthName(month)} {year}. The first run can take several minutes; every month is cached, so repeat checks are fast.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {view === 'status' && data && (
        <section>
          {data.warnings.map((w) => <p className="warn" key={w}>{w}</p>)}
          <div className="bar">
            <div>
              <strong>{data.queries.length}</strong> {data.queries.length === 1 ? 'line' : 'lines'}, {data.rows.filter((r) => r.matched).length} accounts found, {data.rows.filter((r) => !r.matched).length} not found. Bills for {monthName(data.month)} {data.year}
              <div className="note">{cacheNote}</div>
            </div>
            <div className="actions">
              <button
                onClick={async () => {
                  await copyForExcel(data.rows, data.month, data.year);
                  flash('all');
                }}
                disabled={!data.rows.length}
              >
                {copied === 'all' ? 'Copied' : 'Copy for Excel'}
              </button>
              <button onClick={() => downloadXlsx(data.rows, data.month, data.year)} disabled={!data.rows.length}>Download Excel</button>
              <button onClick={() => downloadCsv(data.rows, data.month, data.year)} disabled={!data.rows.length}>Download CSV</button>
              <button onClick={() => void runStatus(true)} disabled={!!loading}>Refresh data</button>
            </div>
          </div>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key}>
                      <span className="th">
                        {c.label}
                        <button
                          type="button"
                          className="colcopy"
                          onClick={async () => {
                            await copyColumn(data.rows.map(c.get));
                            flash(`s-${c.key}`);
                          }}
                          aria-label={`Copy ${c.label} column`}
                          title={`Copy the ${c.label} column`}
                        >
                          {copied === `s-${c.key}` ? 'Copied' : 'Copy'}
                        </button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.query}|${r.accountNumber}|${r.accountName}`} className={r.matched ? '' : 'missing'}>
                    <td>{r.query}</td>
                    <td>{r.accountName || '—'}</td>
                    <td>{r.accountNumber || '—'}</td>
                    <td>
                      <span className={badgeClass(r.multiservicesStatus)}>{r.multiservicesStatus}</span>
                      {r.multiservicesDetail && <small>{r.multiservicesDetail}</small>}
                    </td>
                    <td>
                      <span className={badgeClass(r.billStatus)}>{r.billStatus}</span>
                      {r.billDetail && <small>{r.billDetail}</small>}
                    </td>
                    <td>{r.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === 'unpaid' && unpaid && (
        <section>
          {unpaid.warnings.map((w) => <p className="warn" key={w}>{w}</p>)}
          <div className="bar">
            <div>
              <strong>{unpaid.rows.filter((r) => !r.note).length}</strong> unpaid bills for{' '}
              {new Set(unpaid.rows.filter((r) => !r.note).map((r) => r.accountNumber || r.accountName)).size} accounts.{' '}
              {unpaid.rows.filter((r) => r.note === 'NO UNPAID BILLS').length} with none, {unpaid.rows.filter((r) => r.note === 'NOT FOUND').length} not found.
              <div className="note">
                {monthName(unpaid.periods[0].month)} {unpaid.periods[0].year} to {monthName(unpaid.periods[unpaid.periods.length - 1].month)} {unpaid.periods[unpaid.periods.length - 1].year}. One bill per account per month.
              </div>
            </div>
            <div className="actions">
              <button
                onClick={async () => {
                  await copyTable(unpaidTable(unpaid));
                  flash('u-all');
                }}
                disabled={!unpaid.rows.length}
              >
                {copied === 'u-all' ? 'Copied' : 'Copy for Excel'}
              </button>
              <button onClick={() => downloadXlsxTable(unpaidTable(unpaid), unpaidStem(unpaid))} disabled={!unpaid.rows.length}>Download Excel</button>
              <button onClick={() => downloadCsvTable(unpaidTable(unpaid), unpaidStem(unpaid))} disabled={!unpaid.rows.length}>Download CSV</button>
              <button onClick={() => void runUnpaid(true)} disabled={!!loading}>Refresh data</button>
            </div>
          </div>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {UNPAID_COLUMNS.map((c) => (
                    <th key={c.key}>
                      <span className="th">
                        {c.label}
                        <button
                          type="button"
                          className="colcopy"
                          onClick={async () => {
                            await copyColumn(unpaid.rows.map(c.get));
                            flash(`u-${c.key}`);
                          }}
                          aria-label={`Copy ${c.label} column`}
                          title={`Copy the ${c.label} column`}
                        >
                          {copied === `u-${c.key}` ? 'Copied' : 'Copy'}
                        </button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unpaid.rows.map((r, i) => (
                  <tr key={`${r.query}|${r.accountNumber}|${r.accountName}|${r.year}-${r.month}|${i}`} className={r.note === 'NOT FOUND' ? 'missing' : ''}>
                    <td>{r.query}</td>
                    <td>{r.accountName || '—'}</td>
                    <td>{r.accountNumber || '—'}</td>
                    <td>{r.month ? monthName(r.month) : ''}</td>
                    <td>{r.year || ''}</td>
                    <td>{r.total}</td>
                    <td>
                      {r.note ? <span className={r.note === 'NO UNPAID BILLS' ? 'badge ok' : 'badge neutral'}>{r.note}</span> : <span className="badge bad">UNPAID</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
