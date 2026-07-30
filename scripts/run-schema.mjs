import { readFileSync } from "node:fs";
import { Pool, neonConfig } from "@neondatabase/serverless";

neonConfig.poolQueryViaFetch = true;

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const line = envText.split("\n").find((l) => l.startsWith("DATABASE_URL="));
if (!line) throw new Error("DATABASE_URL not found in .env");
const connectionString = line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");

const sqlText = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

// Split on ';' but don't split inside a $$ ... $$ dollar-quoted block (used by the DO block).
function splitStatements(text) {
  const statements = [];
  let current = "";
  let inDollar = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "$" && text[i + 1] === "$") {
      inDollar = !inDollar;
      current += "$$";
      i++;
      continue;
    }
    if (text[i] === ";" && !inDollar) {
      statements.push(current.trim());
      current = "";
      continue;
    }
    current += text[i];
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s.length > 0 && !s.split("\n").every((l) => l.trim().startsWith("--") || l.trim() === ""));
}

const pool = new Pool({ connectionString });
const statements = splitStatements(sqlText);

for (const stmt of statements) {
  const label = stmt.split("\n")[0].slice(0, 70);
  process.stdout.write(`Running: ${label}...\n`);
  await pool.query(stmt);
}
await pool.end();

console.log(`schema.sql applied successfully (${statements.length} statements).`);
