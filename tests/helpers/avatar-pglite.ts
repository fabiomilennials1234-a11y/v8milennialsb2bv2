/**
 * PGlite com a migration REAL da foto do contato (20280128000000) e os dublês
 * de sessão por GUC (org, caixa, escopo), mais um shim supabase-js → PGlite
 * com só o que `supabaseAvatarStore` usa. Storage em memória, espelhado em
 * `storage.objects` para a policy e o rollback enxergarem.
 *
 * Usado por tests/unit/contact-avatar-sync-e2e.test.ts.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
export const AVATAR_MIGRATION = read("supabase/migrations/20280128000000_avatar_do_contato_whatsapp.sql");
export const AVATAR_CRON_MIGRATION = read("supabase/migrations/20280128000100_cron_avatar_do_contato.sql");
const BASELINE = read("supabase/migrations/20260101000000_baseline_prod_schema.sql").split("\n");
const slice = (from: number, to: number) => BASELINE.slice(from - 1, to).join("\n");

export async function makeAvatarDb(): Promise<PGlite> {
  const db = new PGlite();
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
    CREATE TABLE public.whatsapp_instance_secrets (instance_id uuid PRIMARY KEY, organization_id uuid, uazapi_token text);
    CREATE TABLE public.cron_config (key text PRIMARY KEY, value text);
    CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT unnest(string_to_array(NULLIF(current_setting('test.orgs', true), ''), ','))::uuid $$;
    CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT current_setting('test.master', true) = '1' $$;
    CREATE FUNCTION public.whatsapp_readable_instance_ids(p_org uuid, p_instances uuid[] DEFAULT NULL)
    RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.get_my_organization_ids() g(id) WHERE g.id = p_org)
         AND NOT public.is_master_user() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;
      RETURN ARRAY(SELECT wi.id FROM public.whatsapp_instances wi WHERE wi.organization_id = p_org);
    END $$;
    CREATE FUNCTION public.can_see_chat_scope(p_org uuid, p_lead uuid, p_phone text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT true $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    GRANT ALL ON storage.objects TO anon, authenticated, service_role;
  `);
  await db.exec(slice(15406, 15443)); // normalize_brazilian_phone (baseline de prod)
  await db.exec(slice(18001, 18004)); // set_updated_at (baseline de prod)
  await db.exec(AVATAR_MIGRATION);
  return db;
}

export async function asRole<T = Record<string, unknown>>(db: PGlite, role: string, sql: string, params: unknown[] = []) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("RESET ROLE");
  }
}

type Res = { data: unknown; error: { message?: string; code?: string } | null };
type Filter = [column: string, op: "eq" | "in", value: unknown];
interface QueryState {
  op: "select" | "delete" | "update" | "upsert";
  cols: string;
  ret: string | null;
  filters: Filter[];
  order?: string;
  limit?: number;
  patch?: Record<string, unknown>;
  row?: Record<string, unknown>;
  conflict?: string;
  single?: boolean;
}

export type AvatarBucket = Map<string, { bytes: Uint8Array; contentType: string }>;

/** Shim supabase-js como service_role. Cada filtro vira parâmetro, nunca texto. */
export function pgSupabase(db: PGlite, bucket: AvatarBucket) {
  const run = async (sql: string, params: unknown[]): Promise<Res> => {
    try {
      return { data: await asRole(db, "service_role", sql, params), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } };
    }
  };

  function from(table: string) {
    const st: QueryState = { op: "select", cols: "*", ret: null, filters: [] };
    async function exec(): Promise<Res> {
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      const where = st.filters.length
        ? " WHERE " + st.filters
          .map(([c, op, v]) => (op === "in" ? `${c}::text = ANY(${p(v)}::text[])` : `${c}::text = ${p(v)}`))
          .join(" AND ")
        : "";
      let sql: string;
      if (st.op === "select") {
        sql = `SELECT ${st.cols} FROM public.${table}${where}${st.order ? ` ORDER BY ${st.order}` : ""}${st.limit ? ` LIMIT ${st.limit}` : ""}`;
      } else if (st.op === "delete") {
        sql = `DELETE FROM public.${table}${where}`;
      } else if (st.op === "update") {
        const sets = Object.entries(st.patch ?? {}).map(([k, v]) => `${k} = ${p(v)}`).join(", ");
        sql = `UPDATE public.${table} SET ${sets}${where}${st.ret ? ` RETURNING ${st.ret}` : ""}`;
      } else {
        const row = st.row ?? {};
        const keys = Object.keys(row);
        sql = `INSERT INTO public.${table} (${keys.join(",")}) VALUES (${keys.map((k) => p(row[k])).join(",")}) ON CONFLICT (${st.conflict}) DO NOTHING`;
      }
      const r = await run(sql, params);
      if (r.error) return r;
      const rows = r.data as unknown[];
      if (st.single) return { data: rows[0] ?? null, error: null };
      if (st.op === "update" && !st.ret) return { data: null, error: null };
      return { data: rows, error: null };
    }
    const chain = {
      select(c: string) {
        if (st.op === "select") st.cols = c;
        else st.ret = c;
        return chain;
      },
      order(c: string) { st.order = c; return chain; },
      limit(n: number) { st.limit = n; return chain; },
      in(c: string, v: string[]) { st.filters.push([c, "in", v]); return chain; },
      eq(c: string, v: string) { st.filters.push([c, "eq", v]); return chain; },
      delete() { st.op = "delete"; return chain; },
      update(patch: Record<string, unknown>) { st.op = "update"; st.patch = patch; return chain; },
      upsert(row: Record<string, unknown>, o: { onConflict: string; ignoreDuplicates: boolean }) {
        st.op = "upsert"; st.row = row; st.conflict = o.onConflict; return chain;
      },
      maybeSingle() { st.single = true; return chain; },
      then<A, B = never>(ok?: ((r: Res) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
        return exec().then(ok, ko);
      },
    };
    return chain;
  }

  return {
    from,
    async rpc(fn: string, args: Record<string, unknown>): Promise<Res> {
      if (fn === "reivindicar_avatares") {
        return run("SELECT * FROM public.reivindicar_avatares($1, $2::uuid[])", [args.p_limit, args.p_exclude]);
      }
      if (fn === "podar_avatares_orfaos") {
        const r = await run("SELECT public.podar_avatares_orfaos($1) AS n", [args.p_limit]);
        return r.error ? r : { data: (r.data as Array<{ n: number }>)[0].n, error: null };
      }
      throw new Error(`rpc não dublada: ${fn}`);
    },
    storage: {
      from(_bucket: string) {
        return {
          async remove(paths: string[]): Promise<Res> {
            for (const x of paths) bucket.delete(x);
            await db.query("DELETE FROM storage.objects WHERE bucket_id = 'contact-avatars' AND name = ANY($1)", [paths]);
            return { data: [], error: null };
          },
          async upload(path: string, body: Uint8Array, opts: { contentType: string }): Promise<Res> {
            if (body.byteLength > 2097152) return { data: null, error: { message: "Payload too large" } };
            bucket.set(path, { bytes: body, contentType: opts.contentType });
            await db.query("DELETE FROM storage.objects WHERE bucket_id = 'contact-avatars' AND name = $1", [path]);
            await db.query("INSERT INTO storage.objects VALUES ('contact-avatars', $1)", [path]);
            return { data: { path }, error: null };
          },
        };
      },
    },
  };
}
