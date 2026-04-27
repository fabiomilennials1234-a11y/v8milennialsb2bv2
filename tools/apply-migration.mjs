// Try multiple connection strategies to apply SQL migrations to dev DB.
// Usage: node tools/apply-migration.mjs <path-to-sql>
import { readFileSync } from "node:fs";
import pg from "pg";

const REF = "bcfadphgsibjzivtbjvc";
const SERVICE_ROLE = process.env.SERVICE_ROLE_KEY || "";
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || "";

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("usage: node tools/apply-migration.mjs <sql-file>");
  process.exit(1);
}
const sql = readFileSync(sqlPath, "utf8");

const configs = [
  DB_PASSWORD && {
    label: "pooler (transaction, 6543) with DB_PASSWORD",
    connection: {
      host: "aws-0-sa-east-1.pooler.supabase.com",
      port: 6543,
      user: `postgres.${REF}`,
      password: DB_PASSWORD,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    },
  },
  DB_PASSWORD && {
    label: "pooler (session, 5432) with DB_PASSWORD",
    connection: {
      host: "aws-0-sa-east-1.pooler.supabase.com",
      port: 5432,
      user: `postgres.${REF}`,
      password: DB_PASSWORD,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    },
  },
  DB_PASSWORD && {
    label: "direct db.{ref}.supabase.co:5432",
    connection: {
      host: `db.${REF}.supabase.co`,
      port: 5432,
      user: "postgres",
      password: DB_PASSWORD,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    },
  },
].filter(Boolean);

if (configs.length === 0) {
  console.error("ERROR: set SUPABASE_DB_PASSWORD (not the JWT) from Dashboard → Project Settings → Database");
  process.exit(2);
}

for (const cfg of configs) {
  console.log(`\n--- trying: ${cfg.label} ---`);
  const client = new pg.Client(cfg.connection);
  try {
    await client.connect();
    console.log("connected OK");
    const res = await client.query(sql);
    console.log("applied OK:", Array.isArray(res) ? `${res.length} statements` : "1 statement");
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error(`FAILED: ${err.code || ""} ${err.message}`);
    try { await client.end(); } catch {}
  }
}
console.error("\nAll connection attempts failed.");
process.exit(3);
