// Database access. Uses DATABASE_URL (Supabase / Neon / any Postgres) when set,
// otherwise an embedded Postgres (PGlite) stored in data/pglite for local development.
let client;

// Neon (free plan) sometimes takes long to wake up: when the connection itself could not be opened, nothing was sent
// to the database yet, so it is safe to try again (3 tries over ~30 s) instead of showing an error to the shop.
const CONNECT_ERRORS = new Set(['CONNECT_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'CONNECTION_CLOSED']);
async function retryConnect(run) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= 3 || !CONNECT_ERRORS.has(e.code) || (e.code !== 'CONNECT_TIMEOUT' && e.code !== 'ECONNREFUSED' && e.query)) throw e;
      console.warn(`database not reachable (${e.code}), retry ${attempt}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function init() {
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import('postgres');
    // Same value types as PGlite: bigint/count() as numbers, and JSON params passed pre-serialised
    // (the app sends JSON.stringify'd text to jsonb columns — postgres.js would otherwise encode it twice)
    const jsonType = (oid) => ({ to: oid, from: [oid], serialize: (v) => (typeof v === 'string' ? v : JSON.stringify(v)), parse: JSON.parse });
    const sql = postgres(process.env.DATABASE_URL, {
      max: 5, prepare: false, idle_timeout: 20, connect_timeout: 12,
      types: {
        bigint: { to: 20, from: [20], serialize: (v) => String(v), parse: (v) => Number(v) },
        json: jsonType(114),
        jsonb: jsonType(3802),
      },
    });
    return {
      query: (text, params = []) => retryConnect(() => sql.unsafe(text, params)),
      exec: (text) => sql.unsafe(text),
      tx: (fn) => retryConnect(() => sql.begin((t) => fn({ query: (text, params = []) => t.unsafe(text, params) }))),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(process.env.PGLITE_DIR || './data/pglite');
  await db.waitReady;
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows,
    exec: (text) => db.exec(text),
    tx: (fn) => db.transaction((t) => fn({ query: async (text, params = []) => (await t.query(text, params)).rows })),
  };
}

export async function db() {
  if (!client) client = init();
  return client;
}

// Website pages read the catalogue copy (server/snapshot.js) instead of waking the database; every write to a
// catalogue table is noted so the copy is refreshed after the response.
let snapshot;
const snap = () => (snapshot ??= import('./snapshot.js'));
const pending = { tables: new Set(), stockOnly: true, deleted: false }; // writes made outside a request
async function noteWrite(text) {
  const s = await snap();
  const w = s.writtenTables(text);
  if (!w) return;
  const target = s.scope.getStore()?.changes || pending;
  target.tables.add(w.table);
  if (!w.stockOnly) target.stockOnly = false;
  if (/^\s*delete/i.test(text) && (w.table === 'products' || w.table === 'variations')) target.deleted = true;
}
const isWrite = (text) => /^\s*(insert|update|delete|with[\s\S]*\b(insert|update|delete)\b)/i.test(text);

export async function query(text, params) {
  const s = await snap();
  if (!process.env.SNAPSHOT_OFF && s.scope.getStore()?.useCopy && s.readsOnlyCopy(text)) { // SNAPSHOT_OFF=1: emergency switch back to the database
    const copy = await s.copyDb();
    if (copy) return (await copy.db.query(text, params)).rows;
  }
  const rows = await (await db()).query(text, params);
  if (isWrite(text)) await noteWrite(text);
  return rows;
}

export async function one(text, params) {
  return (await query(text, params))[0] ?? null;
}

/** Writes noted outside a request (scripts, background work) — taken once */
export function takePendingWrites() {
  if (!pending.tables.size) return null;
  const out = { tables: new Set(pending.tables), stockOnly: pending.stockOnly, deleted: pending.deleted };
  pending.tables.clear(); pending.stockOnly = true; pending.deleted = false;
  return out;
}

export async function tx(fn) {
  // transactions always use the database (stock checks, orders) and note their writes
  return (await db()).tx((t) => fn({ query: async (text, params) => { const rows = await t.query(text, params); if (isWrite(text)) await noteWrite(text); return rows; } }));
}
