// @vitest-environment node
/**
 * Migration 20280128000000 (foto do contato WhatsApp) num Postgres em memória
 * (PGlite). Funções do baseline de prod (normalize_brazilian_phone,
 * set_updated_at) entram literais; helpers de sessão (get_my_organization_ids,
 * is_master_user, whatsapp_readable_instance_ids) são dublês dirigidos por GUC.
 * Os grants padrão do Supabase (ALL/EXECUTE para anon e authenticated em
 * objeto novo de public) são reproduzidos — é contra eles que os REVOKE valem.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MIGRATION = read("supabase/migrations/20280128000000_avatar_do_contato_whatsapp.sql");
const ROLLBACK = read("supabase/migrations/rollback/20280128000000_avatar_do_contato_whatsapp.sql");
const BASELINE = read("supabase/migrations/20260101000000_baseline_prod_schema.sql").split("\n");
const slice = (from: number, to: number) => BASELINE.slice(from - 1, to).join("\n");
const NORMALIZE = slice(15406, 15443);
const SET_UPDATED_AT = slice(18001, 18004);

const ORG1 = "00000000-0000-4000-8000-000000000001";
const ORG2 = "00000000-0000-4000-8000-000000000002";
const BOX1 = "00000000-0000-4000-8000-000000000011";
const BOX1B = "00000000-0000-4000-8000-000000000012";
const BOX2 = "00000000-0000-4000-8000-000000000021";
const URL1 = "https://pps.whatsapp.net/v/t61/abc.jpg?ccb=11-4&oh=x&oe=6900AAAA";
const URL1_NEW_OE = "https://pps.whatsapp.net/v/t61/abc.jpg?ccb=11-4&oh=y&oe=6900BBBB";
const URL2 = "https://pps.whatsapp.net/v/t61/def.jpg?oe=6900AAAA";

const db = new PGlite();

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

    CREATE TABLE public.organizations (id uuid PRIMARY KEY);
    CREATE TABLE public.whatsapp_instances (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'connected', provider text NOT NULL DEFAULT 'uazapi', session_dead_since timestamptz);
    CREATE TABLE public.whatsapp_conversation_summary (
      organization_id uuid NOT NULL, instance_id uuid NOT NULL, normalized_phone text NOT NULL,
      phone_number text, last_message_time timestamptz NOT NULL,
      PRIMARY KEY (organization_id, instance_id, normalized_phone));
    CREATE TABLE public.cron_config (key text PRIMARY KEY, value text);

    CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT unnest(string_to_array(NULLIF(current_setting('test.orgs', true), ''), ','))::uuid $$;
    CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT current_setting('test.master', true) = '1' $$;
    -- Dublê: caixas legíveis = as da org, recortadas por test.boxes quando definido.
    CREATE FUNCTION public.whatsapp_readable_instance_ids(p_org uuid, p_instances uuid[] DEFAULT NULL)
    RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.get_my_organization_ids() g(id) WHERE g.id = p_org)
         AND NOT public.is_master_user() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;
      RETURN ARRAY(SELECT wi.id FROM public.whatsapp_instances wi WHERE wi.organization_id = p_org
        AND (current_setting('test.boxes', true) IS NULL OR current_setting('test.boxes', true) = '*'
             OR wi.id::text = ANY(string_to_array(current_setting('test.boxes', true), ','))));
    END $$;

    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    GRANT ALL ON storage.objects TO anon, authenticated, service_role;
  `);
  await db.exec(NORMALIZE);
  await db.exec(SET_UPDATED_AT);
  await db.exec(MIGRATION);
}, 30000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    RESET ROLE;
    DELETE FROM public.organizations;
    DELETE FROM public.contact_avatar_storage_deletions;
    DELETE FROM storage.objects;
    DELETE FROM public.cron_config;
    INSERT INTO public.organizations VALUES ('${ORG1}'), ('${ORG2}');
    INSERT INTO public.whatsapp_instances (id, organization_id) VALUES ('${BOX1}', '${ORG1}'), ('${BOX1B}', '${ORG1}'), ('${BOX2}', '${ORG2}');
    DELETE FROM public.whatsapp_conversation_summary;
    INSERT INTO public.whatsapp_conversation_summary VALUES
      ('${ORG1}', '${BOX1}', '11999990001', '5511999990001', now() - interval '1 hour'),
      ('${ORG1}', '${BOX1B}', '11999990002', '5511999990002', now() - interval '2 hours'),
      ('${ORG1}', '${BOX1}', '11999990003', '5511999990003', now() - interval '60 days'),
      ('${ORG2}', '${BOX2}', '11999990001', '5511999990001', now());
    SELECT set_config('test.orgs', '', false), set_config('test.master', '', false), set_config('test.boxes', '*', false);
  `);
});

async function as<T = Record<string, unknown>>(role: string, sql: string, params: unknown[] = []) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("RESET ROLE");
  }
}
const register = (org: string, box: string, phone: string, url: string) =>
  as<{ ok: boolean }>("service_role", "SELECT public.registrar_avatar_candidato($1, $2, $3, $4) AS ok", [org, box, phone, url]);
const row = async (org: string, phone: string) =>
  (await db.query<Record<string, unknown>>(
    "SELECT * FROM public.whatsapp_contact_avatars WHERE organization_id = $1 AND normalized_phone = $2", [org, phone],
  )).rows[0];
/** Marca a linha como foto gravada, do jeito que o cron faz. */
async function markOk(org: string, phone: string) {
  const r = await row(org, phone);
  const path = `${org}/avatars/${r.id}.jpg`;
  await db.query(
    `UPDATE public.whatsapp_contact_avatars SET status = 'ok', storage_path = $1, content_sha256 = repeat('a', 64), avatar_updated_at = now() WHERE id = $2`,
    [path, r.id],
  );
  await db.query("INSERT INTO storage.objects VALUES ('contact-avatars', $1)", [path]);
  return path;
}
const queue = async () =>
  (await db.query<{ object_path: string }>("SELECT object_path FROM public.contact_avatar_storage_deletions ORDER BY 1")).rows.map((r) => r.object_path);
const member = (orgs: string, boxes = "*") =>
  db.exec(`SELECT set_config('test.orgs', '${orgs}', false), set_config('test.boxes', '${boxes}', false)`);

describe("privilégios", () => {
  it.each(["anon", "authenticated"])("%s não lê nem escreve as tabelas", async (role) => {
    for (const t of ["whatsapp_contact_avatars", "contact_avatar_storage_deletions"]) {
      await expect(as(role, `SELECT * FROM public.${t}`)).rejects.toThrow(/permission denied/);
      await expect(as(role, `DELETE FROM public.${t}`)).rejects.toThrow(/permission denied/);
    }
  });

  it("RLS ligada nas duas tabelas", async () => {
    const r = await db.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('whatsapp_contact_avatars', 'contact_avatar_storage_deletions')",
    );
    expect(r.rows).toEqual([{ relrowsecurity: true }, { relrowsecurity: true }]);
  });

  it.each([
    ["registrar_avatar_candidato(uuid, uuid, text, text)", false, false, true],
    ["reivindicar_avatares(integer)", false, false, true],
    ["podar_avatares_orfaos(integer)", false, false, true],
    ["avatares_das_conversas(uuid, text[])", false, true, false],
    ["enfileirar_remocao_avatar()", false, false, false],
  ])("EXECUTE em %s: anon=%s authenticated=%s service_role=%s", async (fn, anon, auth, svc) => {
    const q = (role: string) =>
      db.query<{ ok: boolean }>(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') AS ok`);
    expect((await q("anon")).rows[0].ok).toBe(anon);
    expect((await q("authenticated")).rows[0].ok).toBe(auth);
    expect((await q("service_role")).rows[0].ok).toBe(svc);
  });

  it("bucket privado, 2 MB, só jpeg/png/webp", async () => {
    const r = await db.query("SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'contact-avatars'");
    expect(r.rows).toEqual([{ public: false, file_size_limit: 2097152, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }]);
  });
});

describe("registrar_avatar_candidato", () => {
  it("normaliza o telefone e cria pendente", async () => {
    expect(await register(ORG1, BOX1, "5511999990001", URL1)).toEqual([{ ok: true }]);
    const r = await row(ORG1, "11999990001");
    expect(r).toMatchObject({
      status: "pending", attempts: 0, source_instance_id: BOX1, candidate_url: URL1,
      candidate_key: "https://pps.whatsapp.net/v/t61/abc.jpg", storage_path: null,
    });
  });

  it("idempotente: mesma foto no mesmo dia não escreve; oe novo também não", async () => {
    await register(ORG1, BOX1, "5511999990001", URL1);
    expect(await register(ORG1, BOX1, "5511999990001", URL1)).toEqual([{ ok: false }]);
    expect(await register(ORG1, BOX1, "5511999990001", URL1_NEW_OE)).toEqual([{ ok: false }]);
    expect((await db.query("SELECT count(*)::int AS n FROM public.whatsapp_contact_avatars")).rows).toEqual([{ n: 1 }]);
  });

  it("mesma foto vista há mais de 1 dia renova a URL sem voltar a pendente", async () => {
    await register(ORG1, BOX1, "5511999990001", URL1);
    await markOk(ORG1, "11999990001");
    await db.exec("UPDATE public.whatsapp_contact_avatars SET candidate_seen_at = now() - interval '2 days'");
    expect(await register(ORG1, BOX1, "5511999990001", URL1_NEW_OE)).toEqual([{ ok: true }]);
    expect(await row(ORG1, "11999990001")).toMatchObject({ status: "ok", candidate_url: URL1_NEW_OE });
  });

  it("foto trocada volta a pendente e zera tentativas", async () => {
    await register(ORG1, BOX1, "5511999990001", URL1);
    await markOk(ORG1, "11999990001");
    await db.exec("UPDATE public.whatsapp_contact_avatars SET attempts = 2");
    expect(await register(ORG1, BOX1B, "5511999990001", URL2)).toEqual([{ ok: true }]);
    expect(await row(ORG1, "11999990001")).toMatchObject({ status: "pending", attempts: 0, source_instance_id: BOX1B });
  });

  it("caixa de outra org → 42501", async () => {
    await expect(register(ORG1, BOX2, "5511999990001", URL1)).rejects.toMatchObject({ code: "42501" });
  });

  it.each([
    ["http", "http://pps.whatsapp.net/a.jpg"],
    ["host de fora", "https://evil.example/a.jpg"],
    ["sufixo enganoso", "https://pps.whatsapp.net.evil.example/a.jpg"],
    ["userinfo", "https://user@pps.whatsapp.net/a.jpg"],
    ["porta", "https://pps.whatsapp.net:8443/a.jpg"],
    ["longa", `https://pps.whatsapp.net/${"a".repeat(2100)}`],
  ])("URL fora da allowlist (%s) → 22023", async (_n, url) => {
    await expect(register(ORG1, BOX1, "5511999990001", url)).rejects.toMatchObject({ code: "22023" });
  });

  it("telefone inválido → 22023", async () => {
    await expect(register(ORG1, BOX1, "abc", URL1)).rejects.toMatchObject({ code: "22023" });
  });
});

describe("avatares_das_conversas", () => {
  const call = (org: string, phones: string[]) =>
    as("authenticated", "SELECT * FROM public.avatares_das_conversas($1, $2)", [org, phones]);

  beforeEach(async () => {
    await register(ORG1, BOX1, "5511999990001", URL1);
    await register(ORG1, BOX1B, "5511999990002", URL2);
    await markOk(ORG1, "11999990001");
  });

  it("membro da org recebe path e sha só de foto ok, com o telefone como pediu", async () => {
    await member(ORG1);
    const r = await call(ORG1, ["5511999990001", "5511999990002", "5511999990009"]);
    expect(r).toEqual([{ phone: "5511999990001", storage_path: expect.stringMatching(new RegExp(`^${ORG1}/avatars/`)), content_sha256: "a".repeat(64) }]);
  });

  it("org que não é do chamador → 42501", async () => {
    await member(ORG2);
    await expect(call(ORG1, ["5511999990001"])).rejects.toMatchObject({ code: "42501" });
  });

  it("membro sem a caixa da conversa não recebe nada", async () => {
    await member(ORG1, BOX1B);
    expect(await call(ORG1, ["5511999990001"])).toEqual([]);
  });

  it("mais de 500 telefones → 22023", async () => {
    await member(ORG1);
    await expect(call(ORG1, Array.from({ length: 501 }, (_, i) => `55119${String(i).padStart(8, "0")}`))).rejects.toMatchObject({ code: "22023" });
  });

  it("anon não executa", async () => {
    await expect(as("anon", "SELECT * FROM public.avatares_das_conversas($1, $2)", [ORG1, ["1"]])).rejects.toThrow(/permission denied/);
  });
});

describe("policy de leitura do Storage", () => {
  let path = "";
  beforeEach(async () => {
    await register(ORG1, BOX1, "5511999990001", URL1);
    path = await markOk(ORG1, "11999990001");
    await db.query("INSERT INTO storage.objects VALUES ('contact-avatars', $1), ('contact-avatars', $2), ('outro', $3)", [
      `${ORG1}/avatars/../../x.jpg`, `${ORG1}/avatars/00000000-0000-4000-8000-999999999999.jpg`, `${ORG1}/avatars/x.jpg`,
    ]);
  });
  const visible = () =>
    as<{ name: string }>("authenticated", "SELECT name FROM storage.objects WHERE bucket_id = 'contact-avatars'");

  it("membro com a caixa lê só o objeto de linha ok", async () => {
    await member(ORG1);
    expect(await visible()).toEqual([{ name: path }]);
  });

  it("outra org e membro sem caixa não leem", async () => {
    await member(ORG2);
    expect(await visible()).toEqual([]);
    await member(ORG1, BOX1B);
    expect(await visible()).toEqual([]);
  });

  it("anon não lê (policy é só de authenticated)", async () => {
    expect(await as("anon", "SELECT name FROM storage.objects WHERE bucket_id = 'contact-avatars'")).toEqual([]);
  });

  it("sem policy de escrita para authenticated", async () => {
    await member(ORG1);
    await expect(as("authenticated", "INSERT INTO storage.objects VALUES ('contact-avatars', $1)", [path])).rejects.toThrow(/row-level security/);
  });

  it("texto da policy: bucket, pasta avatars, org do chamador e caixa", async () => {
    const r = await db.query<{ qual: string; cmd: string; roles: string[] }>(
      "SELECT qual, cmd, roles::text[] AS roles FROM pg_policies WHERE policyname = 'contact_avatars_select'",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].cmd).toBe("SELECT");
    expect(r.rows[0].roles).toEqual(["authenticated"]);
    expect(r.rows[0].qual).toMatch(/bucket_id = 'contact-avatars'/);
    expect(r.rows[0].qual).toMatch(/split_part\(name, '\/'::text, 2\) = 'avatars'/);
    expect(r.rows[0].qual).toMatch(/get_my_organization_ids/);
    expect(r.rows[0].qual).toMatch(/contact_avatar_object_readable/);
  });
});

describe("fila de remoção", () => {
  beforeEach(async () => {
    await register(ORG1, BOX1, "5511999990001", URL1);
  });

  it("apagar a linha enfileira o arquivo", async () => {
    const path = await markOk(ORG1, "11999990001");
    await db.exec("DELETE FROM public.whatsapp_contact_avatars");
    expect(await queue()).toEqual([path]);
  });

  it("foto que sumiu (storage_path → null) enfileira; sem arquivo não enfileira", async () => {
    await db.exec("UPDATE public.whatsapp_contact_avatars SET status = 'none'");
    expect(await queue()).toEqual([]);
    const path = await markOk(ORG1, "11999990001");
    await db.exec("UPDATE public.whatsapp_contact_avatars SET status = 'none', storage_path = NULL, content_sha256 = NULL");
    expect(await queue()).toEqual([path]);
  });

  it("cascade da org enfileira", async () => {
    const path = await markOk(ORG1, "11999990001");
    await db.exec(`DELETE FROM public.organizations WHERE id = '${ORG1}'`);
    expect(await queue()).toEqual([path]);
  });

  it("path fora do formato é recusado pelo CHECK", async () => {
    await expect(db.exec("UPDATE public.whatsapp_contact_avatars SET storage_path = 'x/../y.jpg'")).rejects.toThrow(/path_shape/);
  });
});

describe("reivindicar_avatares", () => {
  const claim = (n = 25) =>
    as<Record<string, unknown>>("service_role", "SELECT * FROM public.reivindicar_avatares($1)", [n]);

  beforeEach(async () => {
    await register(ORG1, BOX1, "5511999990001", URL1);
    await register(ORG1, BOX1B, "5511999990002", URL2);
    await register(ORG1, BOX1, "5511999990003", URL2); // conversa de 60 dias
  });

  it("pega pendentes com conversa recente, carimba o claim e não devolve de novo", async () => {
    const first = await claim();
    expect(first.map((r) => r.normalized_phone).sort()).toEqual(["11999990001", "11999990002"]);
    expect(first.find((r) => r.normalized_phone === "11999990001")).toMatchObject({
      details_instance_id: BOX1, details_number: "5511999990001", status: "pending",
    });
    expect(await claim()).toEqual([]);
  });

  it("respeita o limite e o teto de 25", async () => {
    expect(await claim(1)).toHaveLength(1);
    const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.whatsapp_contact_avatars WHERE claimed_until > now()");
    expect(r.rows[0].n).toBe(1);
  });

  it("caixa desconectada, morta ou não-Uazapi não serve ao fallback", async () => {
    await db.exec(`UPDATE public.whatsapp_instances SET status = 'disconnected' WHERE id = '${BOX1}'`);
    await db.exec(`UPDATE public.whatsapp_instances SET session_dead_since = now() WHERE id = '${BOX1B}'`);
    const r = await claim();
    expect(r.every((x) => x.details_instance_id === null)).toBe(true);
  });

  it("recuo por tentativa: pendente que falhou agora espera", async () => {
    await db.exec("UPDATE public.whatsapp_contact_avatars SET attempts = 1, avatar_updated_at = now()");
    expect(await claim()).toEqual([]);
    await db.exec("UPDATE public.whatsapp_contact_avatars SET avatar_updated_at = now() - interval '2 hours'");
    expect(await claim()).toHaveLength(2);
  });

  it("ok revisita só depois de 7 dias; none também", async () => {
    await markOk(ORG1, "11999990001");
    await db.exec("UPDATE public.whatsapp_contact_avatars SET status = 'none', avatar_updated_at = now() - interval '1 day' WHERE normalized_phone = '11999990002'");
    expect(await claim()).toEqual([]);
    await db.exec("UPDATE public.whatsapp_contact_avatars SET avatar_updated_at = now() - interval '8 days'");
    expect((await claim()).map((r) => r.status).sort()).toEqual(["none", "ok"]);
  });
});

describe("podar_avatares_orfaos", () => {
  it("apaga só linha sem conversa e enfileira o arquivo", async () => {
    await register(ORG1, BOX1, "5511999990001", URL1);
    await register(ORG1, BOX1B, "5511999990002", URL2);
    const path = await markOk(ORG1, "11999990002");
    await db.exec(`DELETE FROM public.whatsapp_conversation_summary WHERE normalized_phone = '11999990002'`);
    expect(await as("service_role", "SELECT public.podar_avatares_orfaos(200) AS n")).toEqual([{ n: 1 }]);
    expect((await db.query("SELECT normalized_phone FROM public.whatsapp_contact_avatars")).rows).toEqual([{ normalized_phone: "11999990001" }]);
    expect(await queue()).toEqual([path]);
    // varreu a tabela toda: cursor some
    expect((await db.query("SELECT * FROM public.cron_config WHERE key = 'contact_avatar_orphan_cursor'")).rows).toEqual([]);
  });

  it("cursor inválido não quebra", async () => {
    await db.exec("INSERT INTO public.cron_config VALUES ('contact_avatar_orphan_cursor', 'lixo')");
    expect(await as("service_role", "SELECT public.podar_avatares_orfaos(10) AS n")).toEqual([{ n: 0 }]);
  });
});

describe("rollback", () => {
  it("recusa com objeto no bucket e desfaz tudo com o bucket vazio", async () => {
    await register(ORG1, BOX1, "5511999990001", URL1);
    await markOk(ORG1, "11999990001");
    await expect(db.exec(ROLLBACK)).rejects.toThrow(/Rollback recusado/);
    await db.exec("ROLLBACK");
    await db.exec("DELETE FROM storage.objects");
    await db.exec(ROLLBACK);
    const r = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('whatsapp_contact_avatars', 'contact_avatar_storage_deletions')",
    );
    expect(r.rows[0].n).toBe(0);
    expect((await db.query("SELECT * FROM storage.buckets WHERE id = 'contact-avatars'")).rows).toEqual([]);
    expect((await db.query("SELECT * FROM pg_policies WHERE policyname = 'contact_avatars_select'")).rows).toEqual([]);
    // reaplica: a migration é a mesma que roda em prod depois de um rollback
    await db.exec(MIGRATION);
  });
});
