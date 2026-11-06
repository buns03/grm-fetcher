import type { LookupResponse, UnpaidResponse } from './types';

export async function lookup(queries: string[], month: number, year: number, refresh: boolean): Promise<LookupResponse> {
  const res = await fetch('/api/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries, month, year, refresh }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as LookupResponse;
}

export async function checkUnpaid(queries: string[], month: number, year: number, months: number, refresh: boolean): Promise<UnpaidResponse> {
  const res = await fetch('/api/unpaid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries, month, year, months, refresh }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as UnpaidResponse;
}
