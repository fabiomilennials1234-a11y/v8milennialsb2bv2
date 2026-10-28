// POST /api/v1/leads — a RPC grava o corpo que a rota aceita.
//
// Roda a migration REAL (20271209000000_api_create_lead_campos.sql) num PGlite
// com o mínimo de `leads` que ela toca: índice único parcial por telefone,
// gatilho BEFORE que normaliza, e `api_idempotency_keys` com request_hash.
// A função é SECURITY DEFINER chamada por service_role — RLS não protege este
// caminho, então o recorte por organização é provado aqui, linha por linha.
//
// Run: node --test tests/integration/api-create-lead-campos.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL("../../supabase/migrations/20271209000000_api_create_lead_campos.sql", import.meta.url),
  "utf8",
);

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";

const CAMPOS = {
  name: "João",
  phone: "(11) 99999-0000",
  email: "joao@x.com",
  company: "ACME",
  origin: "landing",
  notes: "veio da landing",
  segment: "varejo",
  faturamento: "1M-5M",
  utm_source: "meta",
  utm_medium: "cpc",
  utm_campaign: "black-friday",
  utm_content: "video-1",
  utm_term: "crm",
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;

    CREATE FUNCTION public.normalize_brazilian_phone(p text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(regexp_replace(coalesce(p, ''), '\\D', '', 'g'), '') $$;

    CREATE TABLE public.leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      name text NOT NULL,
      phone text, email text, company text, origin text, notes text,
      segment text, faturamento text,
      utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
      normalized_phone text,
      phone_compartilhado boolean NOT NULL DEFAULT false,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE UNIQUE INDEX idx_leads_org_phone_unique ON public.leads (organization_id, normalized_phone)
      WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL AND NOT phone_compartilhado;

    CREATE FUNCTION public.tg_leads_normalize_phone() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.normalized_phone := public.normalize_brazilian_phone(NEW.phone); RETURN NEW; END $$;
    CREATE TRIGGER leads_normalize_phone_trigger BEFORE INSERT OR UPDATE ON public.leads
      FOR EACH ROW EXECUTE FUNCTION public.tg_leads_normalize_phone();

    CREATE TABLE public.api_idempotency_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      endpoint text NOT NULL,
      idempotency_key text NOT NULL,
      resource_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      request_hash text
    );
    CREATE UNIQUE INDEX uq_api_idempotency
      ON public.api_idempotency_keys (organization_id, endpoint, idempotency_key);

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  `);
  await db.exec(migration);
  return db;
}

// Chama como a API chama: papel service_role.
async function criar(db, org, lead, key = null) {
  await db.exec("SET ROLE service_role");
  try {
    const { rows } = await db.query("SELECT public.api_create_lead($1, $2::jsonb, $3) AS r", [
      org,
      JSON.stringify(lead),
      key,
    ]);
    return rows[0].r;
  } finally {
    await db.exec("RESET ROLE");
  }
}

async function linha(db, id) {
  const { rows } = await db.query("SELECT * FROM public.leads WHERE id = $1", [id]);
  return rows[0];
}

test("os 13 campos aceitos são gravados na mesma chamada", async () => {
  const db = await fixture();
  try {
    const r = await criar(db, ORG_A, CAMPOS);
    assert.equal(r.status, "created");
    const row = await linha(db, r.lead.id);
    for (const [k, v] of Object.entries(CAMPOS)) assert.equal(row[k], v, `campo ${k}`);
    assert.equal(row.organization_id, ORG_A);
  } finally { await db.close(); }
});

test("texto vazio vira null e origin ausente vira 'api'", async () => {
  const db = await fixture();
  try {
    const r = await criar(db, ORG_A, { name: "Ana", notes: "", utm_source: "" });
    const row = await linha(db, r.lead.id);
    assert.equal(row.notes, null);
    assert.equal(row.utm_source, null);
    assert.equal(row.origin, "api");
  } finally { await db.close(); }
});

test("telefone existente: conflict com o dono, e o Lead existente NÃO muda", async () => {
  const db = await fixture();
  try {
    const original = await criar(db, ORG_A, CAMPOS);
    const antes = await linha(db, original.lead.id);

    const r = await criar(db, ORG_A, {
      name: "Outro", phone: "11 99999 0000", notes: "sobrescreveu?", utm_source: "google",
    });
    assert.equal(r.status, "conflict");
    assert.equal(r.reason, "phone_already_exists");
    assert.equal(r.lead.id, original.lead.id);
    assert.equal(r.lead.name, "João");

    assert.deepEqual(await linha(db, original.lead.id), antes);
    const { rows } = await db.query("SELECT count(*)::int n FROM public.leads");
    assert.equal(rows[0].n, 1);
  } finally { await db.close(); }
});

test("mesmo telefone em outra organização cria", async () => {
  const db = await fixture();
  try {
    const a = await criar(db, ORG_A, CAMPOS);
    const b = await criar(db, ORG_B, CAMPOS);
    assert.equal(b.status, "created");
    assert.notEqual(b.lead.id, a.lead.id);
    assert.equal((await linha(db, b.lead.id)).organization_id, ORG_B);
  } finally { await db.close(); }
});

test("chave da org A não faz replay na org B", async () => {
  const db = await fixture();
  try {
    const a = await criar(db, ORG_A, CAMPOS, "k-1");
    const b = await criar(db, ORG_B, { ...CAMPOS, phone: "11888880000" }, "k-1");
    assert.equal(b.status, "created");
    assert.notEqual(b.lead.id, a.lead.id);
  } finally { await db.close(); }
});

test("registro de chave da org B apontando para Lead da org A não vaza o Lead", async () => {
  const db = await fixture();
  try {
    const a = await criar(db, ORG_A, CAMPOS);
    // Linha forjada/corrompida: a chave é da org B, o recurso é da org A.
    await db.query(
      "INSERT INTO public.api_idempotency_keys (organization_id, endpoint, idempotency_key, resource_id) VALUES ($1, 'POST /leads', 'k-x', $2)",
      [ORG_B, a.lead.id],
    );
    const b = await criar(db, ORG_B, { name: "Maria", phone: "11777770000" }, "k-x");
    assert.equal(b.status, "created");
    assert.notEqual(b.lead.id, a.lead.id);
    assert.equal((await linha(db, b.lead.id)).organization_id, ORG_B);
  } finally { await db.close(); }
});

test("replay com o mesmo corpo devolve replayed e o mesmo Lead", async () => {
  const db = await fixture();
  try {
    const first = await criar(db, ORG_A, CAMPOS, "k-1");
    const again = await criar(db, ORG_A, CAMPOS, "k-1");
    assert.equal(again.status, "replayed");
    assert.equal(again.lead.id, first.lead.id);
    const { rows } = await db.query("SELECT request_hash FROM public.api_idempotency_keys");
    assert.match(rows[0].request_hash, /^[0-9a-f]{64}$/);
  } finally { await db.close(); }
});

test("replay normaliza igual: texto vazio e campo ausente produzem o mesmo hash", async () => {
  const db = await fixture();
  try {
    const first = await criar(db, ORG_A, { name: "Ana", phone: "11666660000", notes: "" }, "k-n");
    const again = await criar(db, ORG_A, { name: "Ana", phone: "11666660000", origin: "api" }, "k-n");
    assert.equal(again.status, "replayed");
    assert.equal(again.lead.id, first.lead.id);
  } finally { await db.close(); }
});

test("mesma chave com corpo diferente → conflict idempotency_key_reused, Lead intacto", async () => {
  const db = await fixture();
  try {
    const first = await criar(db, ORG_A, CAMPOS, "k-dia");
    const antes = await linha(db, first.lead.id);
    const r = await criar(db, ORG_A, { name: "Maria", phone: "11555550000", notes: "outra" }, "k-dia");
    assert.equal(r.status, "conflict");
    assert.equal(r.reason, "idempotency_key_reused");
    assert.equal(r.lead.id, first.lead.id);
    assert.deepEqual(await linha(db, first.lead.id), antes);
    const { rows } = await db.query("SELECT count(*)::int n FROM public.leads");
    assert.equal(rows[0].n, 1);
  } finally { await db.close(); }
});

test("chave legada (request_hash NULL) faz replay mesmo com corpo diferente", async () => {
  const db = await fixture();
  try {
    const first = await criar(db, ORG_A, CAMPOS, "k-velha");
    await db.exec("UPDATE public.api_idempotency_keys SET request_hash = NULL");
    const r = await criar(db, ORG_A, { name: "Maria", phone: "11555550000" }, "k-velha");
    assert.equal(r.status, "replayed");
    assert.equal(r.lead.id, first.lead.id);
  } finally { await db.close(); }
});

test("chave morta (Lead apagado) cria de novo e passa a apontar para o novo", async () => {
  const db = await fixture();
  try {
    const first = await criar(db, ORG_A, CAMPOS, "k-morta");
    await db.query("UPDATE public.leads SET deleted_at = now() WHERE id = $1", [first.lead.id]);
    const novo = await criar(db, ORG_A, { ...CAMPOS, notes: "de novo" }, "k-morta");
    assert.equal(novo.status, "created");
    assert.notEqual(novo.lead.id, first.lead.id);
    const replay = await criar(db, ORG_A, { ...CAMPOS, notes: "de novo" }, "k-morta");
    assert.equal(replay.status, "replayed");
    assert.equal(replay.lead.id, novo.lead.id);
  } finally { await db.close(); }
});

test("ACL: só service_role executa; DEFINER com search_path fixo", async () => {
  const db = await fixture();
  try {
    const sig = "public.api_create_lead(uuid,jsonb,text)";
    const { rows } = await db.query(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') auth,
              has_function_privilege('service_role', $1, 'EXECUTE') svc`,
      [sig],
    );
    assert.deepEqual(rows[0], { anon: false, auth: false, svc: true });

    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(
        db.query("SELECT public.api_create_lead($1, '{\"name\":\"x\"}'::jsonb, NULL)", [ORG_A]),
        /permission denied/,
      );
      await db.exec("RESET ROLE");
    }

    const fn = await db.query(
      "SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure",
      [sig],
    );
    assert.equal(fn.rows[0].prosecdef, true);
    assert.deepEqual(fn.rows[0].proconfig, ["search_path=public, pg_temp"]);
  } finally { await db.close(); }
});
