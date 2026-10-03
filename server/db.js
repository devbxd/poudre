// Database access. Uses DATABASE_URL (Supabase / Neon / any Postgres) when set,
// otherwise an embedded Postgres (PGlite) stored in data/pglite for local development.
let client;

async function init() {
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(process.env.DATABASE_URL, { max: 5, prepare: false, idle_timeout: 20 });
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
