// Database access. Uses DATABASE_URL (Supabase / Neon / any Postgres) when set,
// otherwise an embedded Postgres (PGlite) stored in data/pglite for local development.
let client;

async function init() {
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import('postgres');
    // Same value types as PGlite: bigint/count() as numbers, and JSON params passed pre-serialised
    // (the app sends JSON.stringify'd text to jsonb columns — postgres.js would otherwise encode it twice)
    const jsonType = (oid) => ({ to: oid, from: [oid], serialize: (v) => (typeof v === 'string' ? v : JSON.stringify(v)), parse: JSON.parse });
    const sql = postgres(process.env.DATABASE_URL, {
      max: 5, prepare: false, idle_timeout: 20,
      types: {
        bigint: { to: 20, from: [20], serialize: (v) => String(v), parse: (v) => Number(v) },
        json: jsonType(114),
        jsonb: jsonType(3802),
      },
    });
    return {
      query: (text, params = []) => sql.unsafe(text, params),
      exec: (text) => sql.unsafe(text),
      tx: (fn) => sql.begin((t) => fn({ query: (text, params = []) => t.unsafe(text, params) })),
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

export async function query(text, params) {
  return (await db()).query(text, params);
}

export async function one(text, params) {
  return (await query(text, params))[0] ?? null;
}

export async function tx(fn) {
  return (await db()).tx(fn);
}
