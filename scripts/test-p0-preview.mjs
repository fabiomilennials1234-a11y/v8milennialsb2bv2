// Isolated PostgreSQL concurrency test. Uses the same minimal fixtures as PGlite;
// it does not claim to reproduce the full production schema or RLS.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { withSupabasePreview } from "./supabase-preview-lifecycle.mjs";
const parent = "jsjsmuncfkbsbzqzqhfq";
const token =
  process.env.SUPABASE_ACCESS_TOKEN ||
  readFileSync(".env.development", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("SUPABASE_ACCESS_TOKEN="))
    .map((l) =>
      l
        .slice(l.indexOf("=") + 1)
        .trim()
        .replace(/^['"]|['"]$/g, ""),
    )
    .find((v) => v.startsWith("sbp_"));
if (!token) throw new Error("Missing management token");
async function api(path, method = "GET", body) {
  const r = await fetch(`https://api.supabase.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok)
    throw new Error(
      `Management API ${r.status}: ${(await r.text()).slice(0, 500)}`,
    );
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const vars = Object.fromEntries(
  ["org", "other", "member", "lead", "entry", "pipeline"].map((k, i) => [
    k,
    `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  ]),
);
const source = readFileSync("tests/integration/p0-crm-fixes.test.mjs", "utf8");
const fixture = source
  .slice(source.indexOf("async function fixture()"))
  .match(/await db.exec\(`([\s\S]*?)`\);/)[1]
  .replace(/\$\{(\w+)\}/g, (_, k) => vars[k])
  .replace("CREATE SCHEMA auth;", "")
  .replace(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
    "",
  )
  .replace(/CREATE FUNCTION auth\.uid\(\)[^\r\n]+/, "");
const migrations = [
  "20271021000008_p0_commission_projection.sql",
  "20271021000009_p0_deal_idempotency.sql",
  "20271021000010_p0_proposal_value.sql",
].map((n) => readFileSync(`supabase/migrations/${n}`, "utf8"));
const rollback = readFileSync(
  "supabase/migrations/rollback/20271021000008_p0_crm_functions.sql",
  "utf8",
);
await withSupabasePreview({
  name: `qa-studio-p0-${Date.now()}`,
  allowConcurrent: process.argv.includes("--allow-concurrent"),
  list: () => api(`projects/${parent}/branches`),
  create: (name) =>
    api(`projects/${parent}/branches`, "POST", {
      branch_name: name,
      persistent: false,
      with_data: false,
    }),
  remove: (id) => api(`branches/${id}`, "DELETE"),
  onEvent: (e) => console.log(JSON.stringify(e)),
  test: async (ref) => {
    const query = (query) =>
      api(`projects/${ref}/database/query`, "POST", { query });
    let ready = false;
    for (let i = 0; i < 36; i++) {
      try {
        const b = (await api(`projects/${parent}/branches`)).find(
          (b) => b.project_ref === ref,
        );
        if (
          [
            "MIGRATIONS_FAILED",
            "FUNCTIONS_DEPLOYED",
            "ACTIVE_HEALTHY",
          ].includes(b?.status)
        ) {
          await query("select 1");
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (!ready) throw new Error("Preview unavailable");
    await query(fixture);
    for (const sql of migrations) await query(sql);
    const call = `public.api_create_deal('${vars.org}','${vars.lead}','propostas','aberto',NULL,100,NULL,NULL,'api','concurrent-p0')`;
    const results = await Promise.all([
      query(`BEGIN; SELECT ${call} result; SELECT pg_sleep(2); COMMIT;`),
      query(`SELECT ${call} result;`),
    ]);
    assert.equal((await query("select count(*)::int n from deals"))[0].n, 1);
    const auth = `SET test.uid='${vars.member}'; SET test.org='${vars.org}'; SET test.admin='true';`;
    await Promise.all([
      query(
        `BEGIN; ${auth} SELECT garantir_negocio_da_entrada('${vars.entry}'); SELECT pg_sleep(2); COMMIT;`,
      ),
      query(
        `BEGIN; ${auth} SELECT garantir_negocio_da_entrada('${vars.entry}'); COMMIT;`,
      ),
    ]);
    assert.equal((await query("select count(*)::int n from deals"))[0].n, 2);
    assert.equal(
      (
        await query(
          "select has_function_privilege('anon','public.editar_valor_proposta(uuid,numeric,timestamptz)','EXECUTE') allowed",
        )
      )[0].allowed,
      false,
    );
    await query(rollback);
    console.log(
      "PASS: concurrent API replay, concurrent materialization, ACL and rollback execution",
    );
  },
});
