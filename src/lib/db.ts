import { Pool } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Missing DATABASE_URL environment variable.");
}

// Pool structure is recommended for handling multiple requests at scale (3k+ users)
export const pool = new Pool({ connectionString });

/**
 * Executes a parameterized SQL query against the Neon database.
 */
export async function sqlQuery(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
