import { accountNumberMatches } from './accountNumber';

// Order-insensitive fuzzy name matching (from the old Customer Fetcher).
export function tokenize(str = ''): string[] {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function tokenScore(q: string, c: string): number {
  if (q === c) return 1;
  if (q.length >= 3 && c.startsWith(q)) return 0.9;
  if (q.length === 1 && c.startsWith(q)) return 0.7;
  if (q.length >= 5 && levenshtein(q, c, 1) <= 1) return 0.85;
  if (q.length >= 8 && levenshtein(q, c, 2) <= 2) return 0.75;
  return 0;
}

export function scoreName(queryTokens: string[], candidateTokens: string[]): number {
  const used = new Set<number>();
  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    let bestIdx = -1;
    candidateTokens.forEach((c, i) => {
      if (used.has(i)) return;
      const s = tokenScore(q, c);
      if (s > best) { best = s; bestIdx = i; }
    });
    if (best === 0) return 0;
    used.add(bestIdx);
    total += best;
  }
  const extra = candidateTokens.length - queryTokens.length;
  return total / queryTokens.length - Math.max(0, extra) * 0.01;
}

export function findMatches<T extends { accountName: string; accountNo?: string; _tokens?: string[] }>(
  query: string, rows: T[], { limit = 5 } = {},
): { row: T; score: number }[] {
  // A purely numeric query (6+ digits) is an account-number lookup, not a
  // name — match it exactly, or against the 6-digit unique-id segment.
  const compact = query.replace(/[\s-]/g, '');
  if (/^\d{6,}$/.test(compact)) {
    const hits = rows.filter((row) => row.accountNo && accountNumberMatches(compact, row.accountNo));
    if (hits.length) return hits.map((row) => ({ row, score: 1 }));
  }

  const qt = tokenize(query);
  if (!qt.length) return [];
  const scored: { row: T; score: number }[] = [];
  for (const row of rows) {
    const s = scoreName(qt, row._tokens || tokenize(row.accountName));
    if (s > 0) scored.push({ row, score: s });
  }
  if (!scored.length) return [];
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  return scored.filter((x) => x.score >= best - 0.005).slice(0, limit);
}