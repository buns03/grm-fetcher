import * as XLSX from 'xlsx';
import type { ResultRow } from './types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: number) => MONTHS[m - 1];

const HEADERS = ['Searched', 'Account Name', 'Account No.', 'Multiservices Status', 'Bill Status', 'Remark', 'Month', 'Year'];

function toTable(rows: ResultRow[], month: number, year: number): string[][] {
  return [
    HEADERS,
    ...rows.map((r) => [r.query, r.accountName, r.accountNumber, r.multiservicesStatus, r.billStatus, r.remark, monthName(month), String(year)]),
  ];
}

const fileStem = (month: number, year: number) => `status-${year}-${String(month).padStart(2, '0')}`;

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadXlsx(rows: ResultRow[], month: number, year: number) {
  const ws = XLSX.utils.aoa_to_sheet(toTable(rows, month, year));
  ws['!cols'] = [{ wch: 30 }, { wch: 34 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Status');
  XLSX.writeFile(wb, `${fileStem(month, year)}.xlsx`);
}

export function downloadCsv(rows: ResultRow[], month: number, year: number) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = toTable(rows, month, year).map((r) => r.map(esc).join(',')).join('\r\n');
  // BOM so Excel reads UTF-8 correctly
  download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `${fileStem(month, year)}.csv`);
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

const flat = (v: string) => v.replace(/[\t\r\n]+/g, ' ');

// Whole table, tab-separated: pastes into Excel as separate cells.
export async function copyForExcel(rows: ResultRow[], month: number, year: number) {
  await writeClipboard(toTable(rows, month, year).map((r) => r.map(flat).join('\t')).join('\n'));
}

// One column, one value per line: pastes down a single Excel column.
// Empty values stay as blank lines so rows keep lining up with your other columns.
export async function copyColumn(values: string[]) {
  await writeClipboard(values.map(flat).join('\n'));
}

// ---- generic table exports (used by Check Unpaid) ----
export function downloadXlsxTable(table: string[][], stem: string) {
  const ws = XLSX.utils.aoa_to_sheet(table);
  ws['!cols'] = table[0].map((_, i) => ({
    wch: Math.min(40, Math.max(10, ...table.slice(0, 300).map((r) => (r[i] ?? '').length + 2))),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Unpaid');
  XLSX.writeFile(wb, `${stem}.xlsx`);
}

export function downloadCsvTable(table: string[][], stem: string) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = table.map((r) => r.map(esc).join(',')).join('\r\n');
  download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `${stem}.csv`);
}

export async function copyTable(table: string[][]) {
  await writeClipboard(table.map((r) => r.map(flat).join('\t')).join('\n'));
}
