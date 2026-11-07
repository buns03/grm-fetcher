import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { cached, cacheKeys, clearCache, peek, isLoading } from "./cache";
import {
  fetchBills,
  fetchMultiservices,
  closeBrowser,
  type Fetched,
} from "./scraper";
import { buildAll, buildUnpaid } from "./lookup";
import { findMatches, tokenize } from "./customerMatcher";
import type { LookupResponse, RawRow, UnpaidResponse } from "./types";

const MAX_LINES = 500;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const STATUS_TTL = 15 * 60 * 1000;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

// A partial read must never replace good saved data: throwing here means nothing is saved.
function guard(f: Fetched): Fetched {
  for (const w of f.warnings) {
    const m = w.match(/reports (\d+) rows but (\d+) were read/);
    if (m && Number(m[2]) < Number(m[1]) * 0.99) {
      throw new Error(
        `Only read ${m[2]} of ${m[1]} rows, so the saved data was kept. Try Refresh again.`,
      );
    }
  }
  return f;
}
const loadMulti = async () => guard(await fetchMultiservices());
const loadBill =
  (y: number, m: number, only: "all" | "unpaid" = "all") =>
  async () =>
    guard(await fetchBills(y, m, only));

function parseQueries(body: any): string[] {
  const raw: unknown[] = Array.isArray(body?.queries) ? body.queries : [];
  const seen = new Set<string>();
  return raw
    .map((q) => String(q).trim())
    .filter(
      (q) => q && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()),
    );
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---------- Status tab ----------
app.post("/api/lookup", async (req, res) => {
  try {
    const queries = parseQueries(req.body);
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    const force = req.body?.refresh === true;
    if (!queries.length)
      return res
        .status(400)
        .json({ error: "Enter at least one account name or account number." });
    if (queries.length > MAX_LINES)
      return res
        .status(400)
        .json({ error: `Maximum ${MAX_LINES} lines per lookup.` });
    if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) {
      return res.status(400).json({ error: "Choose a valid month and year." });
    }
    const [multi, bill] = await Promise.all([
      cached("multiservices", loadMulti, force, STATUS_TTL),
      cached(`bill:${year}-${month}`, loadBill(year, month), force, STATUS_TTL),
    ]);
    const body: LookupResponse = {
      queries,
      month,
      year,
      rows: buildAll(multi.value.rows, bill.value.rows, queries),
      warnings: [...multi.value.warnings, ...bill.value.warnings],
      fetchedAt: { multiservices: multi.fetchedAt, bill: bill.fetchedAt },
      fromCache: { multiservices: multi.fromCache, bill: bill.fromCache },
    };
    res.json(body);
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "Unknown error" });
  }
});

app.post("/api/unpaid", async (req, res) => {
  try {
    const queries = parseQueries(req.body);
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    const months = Math.min(60, Math.max(1, Number(req.body?.months) || 12));
    const force = req.body?.refresh === true;
    if (!queries.length)
      return res
        .status(400)
        .json({ error: "Enter at least one account name or account number." });
    if (queries.length > MAX_LINES)
      return res
        .status(400)
        .json({ error: `Maximum ${MAX_LINES} lines per lookup.` });
    if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) {
      return res.status(400).json({ error: "Choose a valid month and year." });
    }
    const periods = Array.from({ length: months }, (_, i) => {
      const d = new Date(year, month - 1 - i, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }).reverse(); // oldest first

    const warnings: string[] = [];
    const multi = await cached("multiservices", loadMulti, force, STATUS_TTL);
    warnings.push(...multi.value.warnings);

    const loaded = await mapLimit(periods, 3, async (p) => {
      try {
        const r = await cached(
          `bill-unpaid:${p.year}-${p.month}`,
          loadBill(p.year, p.month, "unpaid"),
          force,
          STATUS_TTL,
        );
        warnings.push(...r.value.warnings);
        return { ...p, rows: r.value.rows };
      } catch (e) {
        warnings.push(
          `${MONTH_NAMES[p.month - 1]} ${p.year} could not be read: ${e instanceof Error ? e.message : "unknown error"}`,
        );
        return { ...p, rows: [] };
      }
    });
    const body: UnpaidResponse = {
      queries,
      periods,
      rows: buildUnpaid(multi.value.rows, loaded, queries),
      warnings,
    };
    res.json(body);
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "Unknown error" });
  }
});

// ---------- Customer tab (same routes the old Customer Fetcher UI already calls) ----------
const billToMbps: Record<number, number> = {
  999: 55,
  1299: 105,
  1499: 155,
  1999: 205,
  2499: 305,
};
function billToPlan(billText: string) {
  const amount = parseFloat(String(billText || "").replace(/[^0-9.]/g, ""));
  if (!amount) return "";
  const mbps = billToMbps[Math.round(amount)];
  return mbps ? `${mbps} MBPS` : `UNKNOWN (BILL ${amount})`;
}

interface CustomerRow {
  accountName: string;
  accountNo: string;
  contact: string;
  bill: string;
  plan: string;
  address: string;
  _tokens: string[];
}
let built: { at: number; rows: CustomerRow[] } | null = null;
function customerRows(at: number, rows: RawRow[]) {
  if (built?.at !== at) {
    built = {
      at,
      rows: rows.map((r) => ({
        accountName: r.name,
        accountNo: r.numberRaw,
        contact: r.contact,
        bill: r.amount,
        plan: billToPlan(r.amount),
        address: r.address,
        _tokens: tokenize(r.name),
      })),
    };
  }
  return built.rows;
}
function customerStatus() {
  const e = peek<Fetched>("multiservices");
  return {
    loaded: e?.value.rows.length ?? 0,
    fetchedAt: e?.fetchedAt ?? null,
    syncing: isLoading("multiservices"),
  };
}

app.get("/api/status", (_req, res) => res.json(customerStatus()));

app.post("/api/sync", async (_req, res) => {
  try {
    await cached("multiservices", loadMulti, true);
    res.json(customerStatus());
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "Unknown error" });
  }
});

app.post("/api/search", async (req, res) => {
  try {
    const names = (req.body?.names || [])
      .map((n: unknown) => String(n).trim())
      .filter(Boolean);
    if (!names.length)
      return res.status(400).json({ error: "No names provided." });
    const multi = await cached("multiservices", loadMulti);
    const rows = customerRows(multi.fetchedAt, multi.value.rows);
    const results = names.map((query: string) => {
      const matches = findMatches(query, rows).map(({ row, score }) => {
        const { _tokens, ...clean } = row;
        return { ...clean, score: Number(score.toFixed(2)) };
      });
      return {
        query,
        status:
          matches.length === 0
            ? "not_found"
            : matches.length === 1
              ? "found"
              : "multiple",
        matches,
      };
    });
    res.json({ ...customerStatus(), results });
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "Unknown error" });
  }
});

app.get("/api/cache", (_req, res) => res.json(cacheKeys()));
app.delete("/api/cache", (_req, res) => {
  clearCache();
  res.json({ ok: true });
});

// After `npm run build` in client/, this one server also serves the app: just open http://localhost:4000
const dist = path.resolve(process.cwd(), "../client/dist");
if (fs.existsSync(dist)) app.use(express.static(dist));

const server = app.listen(config.port, () =>
  console.log(`Fetcher on http://localhost:${config.port}`),
);

// Warm up so the first search is instant: accounts + last month's bills (instant when already saved on disk).
if (process.env.PREWARM !== "false") {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  void Promise.allSettled([
    cached("multiservices", loadMulti),
    cached(`bill:${y}-${m}`, loadBill(y, m)),
  ]).then((r) => {
    r.forEach(
      (x) =>
        x.status === "rejected" && console.error("Prewarm failed:", x.reason),
    );
    console.log("Prewarm finished.");
  });
}

process.on("SIGINT", async () => {
  server.close();
  await closeBrowser();
  process.exit(0);
});
