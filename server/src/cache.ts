// Saved to disk (plain JSON files in server/data), no database.
// Entries never expire. They are replaced only by a successful Refresh.
// A failed or partial refresh never overwrites what is already saved.
import fs from 'node:fs';
import path from 'node:path';

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

const VERSION = 1; // bump if the saved data shape changes, old files are then ignored
const DIR = path.resolve(process.env.DATA_DIR ?? 'data');
fs.mkdirSync(DIR, { recursive: true });
const fileOf = (key: string) => path.join(DIR, `${encodeURIComponent(key)}.json`);

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<Entry<unknown>>>();

for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (j.v === VERSION && j.key) store.set(j.key, { value: j.value, fetchedAt: j.fetchedAt });
  } catch {
    console.warn(`Skipping unreadable saved file ${f}`);
  }
}
console.log(`Loaded ${store.size} saved data set(s) from ${DIR}`);

// Write to a temp file, then rename, so a crash mid-write cannot corrupt the saved copy.
async function save(key: string, entry: Entry<unknown>) {
  const file = fileOf(key);
  const tmp = `${file}.tmp`;
  try {
    await fs.promises.writeFile(tmp, JSON.stringify({ v: VERSION, key, value: entry.value, fetchedAt: entry.fetchedAt }));
    await fs.promises.rename(tmp, file);
  } catch (e) {
    console.error(`Could not save ${key} to disk:`, e);
  }
}

export async function cached<T>(
  key: string,
  loader: () => Promise<T>,
  force = false,
  maxAgeMs = Infinity,
): Promise<{ value: T; fetchedAt: number; fromCache: boolean }> {
  if (!force) {
    const hit = store.get(key);
    if (hit && Date.now() - hit.fetchedAt < maxAgeMs) {
      return { value: hit.value as T, fetchedAt: hit.fetchedAt, fromCache: true };
    }
  }
  let pending = inflight.get(key) as Promise<Entry<T>> | undefined;
  if (!pending) {
    pending = loader()
      .then(async (value) => {
        const entry = { value, fetchedAt: Date.now() };
        store.set(key, entry);
        await save(key, entry);
        return entry;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending as Promise<Entry<unknown>>);
  }
  const entry = await pending;
  return { value: entry.value, fetchedAt: entry.fetchedAt, fromCache: false };
}

export const peek = <T>(key: string) => store.get(key) as Entry<T> | undefined;
export const isLoading = (key: string) => inflight.has(key);
export const cacheKeys = () => [...store.entries()].map(([key, e]) => ({ key, fetchedAt: e.fetchedAt }));

export function clearCache() {
  store.clear();
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.json')) fs.rmSync(path.join(DIR, f), { force: true });
}
