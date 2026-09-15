// Explicitly authorized P0 rollout. No credentials are written or printed.
import { readFileSync } from "node:fs";
const ref = "jsjsmuncfkbsbzqzqhfq";
if (!process.argv.includes("--confirm-production"))
  throw new Error("Explicit production confirmation required");
const mode = process.argv[2];
const token = readFileSync(".env.development", "utf8")
  .split(/\r?\n/)
  .filter((l) => l.startsWith("SUPABASE_ACCESS_TOKEN="))
  .map((l) =>
    l
      .slice(l.indexOf("=") + 1)
      .trim()
      .replace(/^['"]|['"]$/g, ""),
  )
  .find((v) => v.startsWith("sbp_"));
const files = [
  "20271021000008_p0_commission_projection.sql",
  "20271021000009_p0_deal_idempotency.sql",
  "20271021000010_p0_proposal_value.sql",
];
const statements = files.map((f) =>
  readFileSync(`supabase/migrations/${f}`, "utf8"),
);
const auth =
  "SELECT set_config('request.jwt.claim.sub','5323d20b-c995-4548-a162-cd1f70dbc88d',true); SELECT set_config('request.jwt.claim.role','authenticated',true); SET LOCAL ROLE authenticated;";
const ledger =
  "SELECT public.get_commission_ledger('6030520a-2ca7-477d-be89-55758e2cd808','month','2026-09-01',NULL,NULL,NULL) result;";
let query;
if (mode === "preflight") {
  const rollback = readFileSync(
    "supabase/migrations/rollback/20271021000008_p0_crm_functions.sql",
    "utf8",
  )
    .replace(/^BEGIN;$/m, "")
    .replace(/^COMMIT;$/m, "");
  query = `BEGIN; SET LOCAL lock_timeout='5s'; ${statements.join("\n")} ${rollback} ${statements[0].replace("CREATE TRIGGER trg_commissions_guard_insert", "DROP TRIGGER IF EXISTS trg_commissions_guard_insert ON public.commissions; CREATE TRIGGER trg_commissions_guard_insert")} ${auth} ${ledger} ROLLBACK;`;
} else if (mode === "apply") {
  const tracking = files
    .map(
      (f, i) =>
        `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${f.slice(0, 14)}','${f.slice(15, -4)}',ARRAY[$p0_sql$${statements[i]}$p0_sql$]);`,
    )
    .join("\n");
  query = `BEGIN; SET LOCAL lock_timeout='5s'; ${statements.join("\n")} ${tracking} COMMIT;`;
} else if (mode === "reconcile") {
  query = readFileSync(
    "supabase/ops/p0-milennials-commission-reconciliation.sql",
    "utf8",
  )
    .replace("BEGIN;", `BEGIN; ${auth}`)
    .replace("COMMIT;", `${ledger} COMMIT;`);
} else throw new Error("Expected preflight, apply or reconcile");
const r = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60000),
  },
);
if (!r.ok)
  throw new Error(
    `Production ${mode} ${r.status}: ${(await r.text()).slice(0, 1500)}`,
  );
console.log(`${mode}: ${await r.text()}`);
