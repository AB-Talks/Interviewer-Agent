import { Pool } from "@neondatabase/serverless";

// Lazy pool initialization — avoids crashing at build time when DATABASE_URL
// is not yet set in the Vercel build environment.
let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Missing DATABASE_URL environment variable.");
    }
    _pool = new Pool({ connectionString });
  }
  return _pool;
}

/** Convenience accessor if you need the pool directly. */
export const pool = new Proxy({} as Pool, {
  get(_target, prop, receiver) {
    return Reflect.get(getPool(), prop, receiver);
  },
});

/**
 * Executes a parameterized SQL query against the Neon database.
 */
export async function sqlQuery(text: string, params?: any[]) {
  const p = getPool();
  const client = await p.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
