// @vitest-environment node
/**
 * contact-avatar-sync ponta a ponta:
 *   runContactAvatarSync REAL + supabaseAvatarStore REAL (adaptador)
 *   → shim supabase-js sobre PGlite com as migrations REAIS (claim, close,
 *     triggers, fila, gate do cron) — tests/helpers/avatar-pglite.ts
 *   → fetch injetado que reescreve *.whatsapp.net para um HTTP server local
 *     (127.0.0.1:0) servindo bytes reais. Nada sai da máquina.
 */
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AVATAR_CRON_MIGRATION, asRole, makeAvatarDb, pgSupabase } from "../helpers/avatar-pglite";
import { runContactAvatarSync, supabaseAvatarStore, type SupabaseLike } from "../../supabase/functions/contact-avatar-sync/sync";
import { JPEG_1PX as JPEG, PNG_1PX as PNG } from "./__fixtures__/avatar-images";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const BIG = (() => { const b = new Uint8Array(3 * 1024 * 1024); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; })();
const AT_LIMIT = (() => { const b = new Uint8Array(2 * 1024 * 1024); b.set([0xff, 0xd8, 0xff, 0xe0]); b[100] = 7; return b; })();
const OVER_LIMIT = (() => { const b = new Uint8Array(2 * 1024 * 1024 + 1); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; })();

const ORG = "00000000-0000-4000-8000-000000000001";
const box = (i: number) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;
const phone = (i: number) => `119999900${String(i).padStart(2, "0")}`;
const OE = Math.floor(Date.now() / 1000 + 86400).toString(16);
const cdn = (path: string) => `https://pps.whatsapp.net/v/t61/${path}?ccb=11-4&oh=x&oe=${OE}`;

// ── HTTP server local ────────────────────────────────────────────────────────
const hits: string[] = [];
let server: Server;
let port = 0;
const routes: Record<string, (res: import("node:http").ServerResponse) => void> = {
  "ok.jpg": (r) => { r.writeHead(200, { "content-type": "image/jpeg" }); r.end(Buffer.from(JPEG)); },
  "ok.png": (r) => { r.writeHead(200, { "content-type": "image/png" }); r.end(Buffer.from(PNG)); },
  "zero.jpg": (r) => { r.writeHead(200, { "content-type": "image/jpeg" }); r.end(); },
  "big.jpg": (r) => { r.writeHead(200, { "content-type": "image/jpeg" }); r.end(Buffer.from(BIG)); },
  "bigchunked.jpg": (r) => {
    r.writeHead(200, { "content-type": "image/jpeg", "transfer-encoding": "chunked" });
    let sent = 0; const step = () => { if (sent >= BIG.length) return r.end(); r.write(Buffer.from(BIG.subarray(sent, sent + 65536))); sent += 65536; setImmediate(step); }; step();
  },
  "limit.jpg": (r) => { r.writeHead(200, { "content-type": "image/jpeg" }); r.end(Buffer.from(AT_LIMIT)); },
  "over.jpg": (r) => { r.writeHead(200, { "content-type": "image/jpeg" }); r.end(Buffer.from(OVER_LIMIT)); },
  "html.jpg": (r) => { r.writeHead(200, { "content-type": "image/jpeg" }); r.end("<!doctype html><html><body>phish</body></html>"); },
  "redirect.jpg": (r) => { r.writeHead(302, { location: `http://127.0.0.1:${port}/ok.jpg` }); r.end(); },
  "403.jpg": (r) => { r.writeHead(403); r.end("URL signature expired"); },
  "500.jpg": (r) => { r.writeHead(500); r.end(); },
};
let finalUrlOverride: string | null = null;
const rewriteFetch: typeof fetch = async (input, init) => {
  const u = new URL(String(input));
  if (!u.hostname.endsWith(".whatsapp.net")) throw new Error(`fetch fora do CDN: ${u.href}`);
  const res = await fetch(`http://127.0.0.1:${port}/${u.pathname.split("/").pop()}`, init);
  const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
  if (finalUrlOverride) Object.defineProperty(out, "url", { value: finalUrlOverride });
  return out;
};

// ── Banco + store ────────────────────────────────────────────────────────────
let db: PGlite;
const bucket = new Map<string, { bytes: Uint8Array; contentType: string }>();
let uploads = 0;
const details = { calls: [] as Array<{ instanceId: string; number: string }>, body: {} as unknown };
const sleeps: number[] = [];

function deps() {
  const sb = pgSupabase(db, bucket);
  const store = supabaseAvatarStore(sb as unknown as SupabaseLike);
  const up = store.upload.bind(store);
  store.upload = async (p, b, c) => { uploads += 1; return up(p, b, c); };
  return {
    store,
    fetch: rewriteFetch,
    detailsClient: (_t: string, instanceId: string) => ({
      async chatDetails(number: string) { details.calls.push({ instanceId, number }); return typeof details.body === "function" ? (details.body as (n: string) => unknown)(number) : details.body; },
    }),
    sleep: async (ms: number) => { sleeps.push(ms); },
    now: () => Date.now(),
    random: () => 0.5,
    log: () => {},
  };
}
const run = () => runContactAvatarSync(deps());
const register = (i: number, url: string, b = box(i)) =>
  asRole(db, "service_role", "SELECT public.registrar_avatar_candidato($1,$2,$3,$4) AS ok", [ORG, b, `55${phone(i)}`, url]);
const row = async (i: number) => (await db.query<Record<string, string | number | null>>("SELECT * FROM public.whatsapp_contact_avatars WHERE normalized_phone = $1", [phone(i)])).rows[0];
const queue = async () => (await db.query<{ object_path: string }>("SELECT object_path FROM public.contact_avatar_storage_deletions")).rows.map((r) => r.object_path);
const killSwitch = (v: string | null) => v === null
  ? db.query("DELETE FROM public.cron_config WHERE key = 'contact_avatar_chat_details'")
  : db.query("INSERT INTO public.cron_config VALUES ('contact_avatar_chat_details', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [v]);
/** Envelhece a linha: carimbo e recuo andam `days` para trás. */
const age = (i: number, days: number) => db.query(
  `UPDATE public.whatsapp_contact_avatars SET avatar_updated_at = now() - interval '${days} days',
     retry_after = retry_after - interval '${days} days' WHERE normalized_phone = $1`, [phone(i)]);
const gateCalls = async () => {
  await db.exec("DELETE FROM net.calls");
  await asRole(db, "service_role", "SELECT public.invoke_contact_avatar_sync()");
  return (await db.query("SELECT * FROM net.calls")).rows.length;
};

beforeAll(async () => {
  server = createServer((req, res) => { const k = (req.url ?? "").slice(1); hits.push(k); (routes[k] ?? ((r) => { r.writeHead(404); r.end(); }))(res); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
  db = await makeAvatarDb();
  await db.exec(`
    GRANT ALL ON public.whatsapp_instance_secrets TO service_role;
    GRANT ALL ON public.cron_config TO service_role;
    CREATE SCHEMA net;
    CREATE TABLE net.calls (url text);
    CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
    RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (url) RETURNING 1::bigint $$;`);
  await db.exec(AVATAR_CRON_MIGRATION);
}, 60000);
afterAll(async () => { await db.close(); server.close(); });

beforeEach(async () => {
  hits.length = 0; bucket.clear(); uploads = 0; details.calls = []; details.body = {}; sleeps.length = 0; finalUrlOverride = null;
  await db.exec(`
    RESET ROLE;
    DELETE FROM public.organizations; DELETE FROM public.contact_avatar_storage_deletions; DELETE FROM storage.objects;
    DELETE FROM public.cron_config; DELETE FROM public.whatsapp_conversation_summary; DELETE FROM public.whatsapp_instance_secrets;
    DELETE FROM net.calls;
    INSERT INTO public.organizations VALUES ('${ORG}');
    INSERT INTO public.cron_config VALUES
      ('campaign_rule_dispatch_url', 'https://p.supabase.co/functions/v1/campaign-rule-dispatch'), ('cron_secret', 's');`);
  for (let i = 1; i <= 10; i++) {
    await db.query("INSERT INTO public.whatsapp_instances (id, organization_id) VALUES ($1, $2)", [box(i), ORG]);
    await db.query("INSERT INTO public.whatsapp_instance_secrets VALUES ($1, $2, $3)", [box(i), ORG, `tok-${i}`]);
    await db.query("INSERT INTO public.whatsapp_conversation_summary VALUES ($1,$2,$3,$4, now() - interval '1 hour')", [ORG, box(i), phone(i), `55${phone(i)}`]);
  }
});

describe("download do CDN", () => {
  it("jpeg válido → ok, path <org>/avatars/<id>.jpg, bytes íntegros, sha carimbado", async () => {
    await register(1, cdn("ok.jpg"));
    const rep = await run();
    const r = await row(1);
    expect(rep).toMatchObject({ claimed: 1, stored: 1, errors: 0, details_calls: 0 });
    expect(r.status).toBe("ok");
    expect(r.storage_path).toBe(`${ORG}/avatars/${r.id}.jpg`);
    expect(r.content_sha256).toBe(sha(JPEG));
    expect(r.claimed_until).toBeNull();
    expect(r.avatar_updated_at).not.toBeNull();
    expect(bucket.get(r.storage_path)).toMatchObject({ contentType: "image/jpeg" });
    expect(sha(bucket.get(r.storage_path)!.bytes)).toBe(sha(JPEG));
    expect(r.storage_path).not.toContain(phone(1));
  });

  it("png real → tipo detectado image/png (path segue .jpg)", async () => {
    await register(1, cdn("ok.png"));
    await run();
    const r = await row(1);
    expect(bucket.get(r.storage_path)!.contentType).toBe("image/png");
  });

  it("exatamente 2 MB passa; 2 MB + 1 recusa", async () => {
    await register(1, cdn("limit.jpg"));
    await register(2, cdn("over.jpg"));
    await run();
    expect((await row(1)).status).toBe("ok");
    expect(await row(2)).toMatchObject({ status: "pending", attempts: 1, last_error: "too_large", storage_path: null });
  });

  it.each([
    ["zero.jpg", "empty"],
    ["big.jpg", "too_large"],
    ["bigchunked.jpg", "too_large"],
    ["html.jpg", "not_image"],
    ["redirect.jpg", "fetch_failed:TypeError"],
    ["500.jpg", "http_500"],
  ])("%s → erro %s, nada no bucket, tentativa contada", async (file, reason) => {
    await register(1, cdn(file));
    const rep = await run();
    expect(rep.errors).toBe(1);
    expect(await row(1)).toMatchObject({ status: "pending", attempts: 1, last_error: reason, storage_path: null, claimed_until: null });
    expect(bucket.size).toBe(0);
  });

  it("redirect: o alvo NUNCA é buscado", async () => {
    await register(1, cdn("redirect.jpg"));
    await run();
    expect(hits).toEqual(["redirect.jpg"]);
  });

  it("URL final fora da allowlist (plataforma que siga redirect) → final_url_not_allowed", async () => {
    finalUrlOverride = "http://169.254.169.254/latest/meta-data";
    await register(1, cdn("ok.jpg"));
    await run();
    expect(await row(1)).toMatchObject({ last_error: "final_url_not_allowed", storage_path: null });
    expect(bucket.size).toBe(0);
  });

  it("3 erros seguidos → status error; recuo de 1h/tentativa entre eles", async () => {
    await register(1, cdn("html.jpg"));
    await run();
    const second = await run();
    expect(second.claimed).toBe(0); // recuo: attempts=1 → retry_after +1 h
    for (let k = 0; k < 2; k++) { await age(1, 1); await run(); }
    expect(await row(1)).toMatchObject({ status: "error", attempts: 3 });
    await age(1, 6); // 6 dias: ainda não revisita
    expect((await run()).claimed).toBe(0);
    await age(1, 8);
    expect((await run()).claimed).toBe(1);
  });

  it("mesmo sha → não sobe de novo, só carimba", async () => {
    await register(1, cdn("ok.jpg"));
    await run();
    expect(uploads).toBe(1);
    await age(1, 8);
    const rep = await run();
    expect(rep).toMatchObject({ claimed: 1, unchanged: 1, stored: 0 });
    expect(uploads).toBe(1);
    expect((await row(1)).status).toBe("ok");
  });

  it("2 rodadas seguidas: ok/none/erro não são re-reivindicados", async () => {
    await register(1, cdn("ok.jpg"));
    await register(2, cdn("html.jpg"));
    await killSwitch("on");
    details.body = { image: "" };
    await register(3, cdn("403.jpg"));
    const r1 = await run();
    expect(r1).toMatchObject({ claimed: 3, stored: 1, errors: 1, none: 1 });
    const r2 = await run();
    expect(r2.claimed).toBe(0);
    expect(hits.filter((h) => h !== "").length).toBe(3);
  });

  it("claim concorrente (2 rodadas em paralelo) não pega a mesma linha", async () => {
    for (let i = 1; i <= 10; i++) await register(i, cdn("ok.jpg"));
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.claimed + b.claimed).toBe(10);
    expect(uploads).toBe(10);
  });
});

describe("fallback /chat/details", () => {
  it("403 com kill switch AUSENTE (default) → não chama details, adia", async () => {
    await register(1, cdn("403.jpg"));
    const rep = await run();
    expect(rep).toMatchObject({ deferred: 1, details_calls: 0 });
    expect(details.calls).toEqual([]);
    expect(await row(1)).toMatchObject({ status: "pending", attempts: 0, last_error: "details_disabled" });
  });

  it.each(["off", "true", "1", "", "yes"])("kill switch '%s' → desligado", async (v) => {
    await killSwitch(v);
    await register(1, cdn("403.jpg"));
    await run();
    expect(details.calls).toEqual([]);
  });

  it("kill switch ' ON ' → ligado (trim/lower)", async () => {
    await killSwitch(" ON ");
    details.body = { imagePreview: cdn("ok.jpg") };
    await register(1, cdn("403.jpg"));
    await run();
    expect(details.calls).toHaveLength(1);
    expect((await row(1)).status).toBe("ok");
  });

  it("kill switch on + body {} → foto ok gravada PRESERVADA (unknown ≠ none)", async () => {
    await register(1, cdn("ok.jpg"));
    await run();
    const before = await row(1);
    await db.query("UPDATE public.whatsapp_contact_avatars SET candidate_url = $1 WHERE id = $2", [cdn("403.jpg"), before.id]);
    await age(1, 8);
    await killSwitch("on");
    details.body = {};
    const rep = await run();
    expect(rep).toMatchObject({ errors: 1, details_calls: 1 });
    const after = await row(1);
    expect(after).toMatchObject({ status: "ok", storage_path: before.storage_path, content_sha256: before.content_sha256, last_error: "details_shape_unknown" });
    expect(bucket.has(before.storage_path)).toBe(true);
    expect(await queue()).toEqual([]);
  });

  it("details com image:'' → none; arquivo enfileirado e drenado na rodada seguinte", async () => {
    await register(1, cdn("ok.jpg"));
    await run();
    const before = await row(1);
    await db.query("UPDATE public.whatsapp_contact_avatars SET candidate_url = $1 WHERE id = $2", [cdn("403.jpg"), before.id]);
    await age(1, 8);
    await killSwitch("on");
    details.body = { image: "" };
    const rep = await run();
    expect(rep.none).toBe(1);
    expect(await row(1)).toMatchObject({ status: "none", storage_path: null, content_sha256: null });
    expect(await queue()).toEqual([before.storage_path]);
    const rep2 = await run();
    expect(rep2.deleted_objects).toBe(1);
    expect(bucket.has(before.storage_path)).toBe(false);
    expect(await queue()).toEqual([]);
    // none não revisita antes de 7 dias
    await age(1, 6);
    expect((await run()).claimed).toBe(0);
  });

  it("10 caixas, kill switch on: no máximo 5 details, 1 por caixa, jitter 2–4 s; o resto adia", async () => {
    await killSwitch("on");
    details.body = { imagePreview: cdn("ok.jpg") };
    for (let i = 1; i <= 10; i++) await register(i, cdn("403.jpg"));
    const rep = await run();
    expect(rep.details_calls).toBe(5);
    expect(new Set(details.calls.map((c) => c.instanceId)).size).toBe(5);
    expect(rep).toMatchObject({ claimed: 10, stored: 5, deferred: 5 });
    expect(sleeps).toHaveLength(4);
    for (const ms of sleeps) { expect(ms).toBeGreaterThanOrEqual(2000); expect(ms).toBeLessThanOrEqual(4000); }
    // número enviado = telefone cru da conversa
    expect(details.calls[0].number).toMatch(/^5511999990\d{3}$/);
  });

  it("3 contatos na MESMA caixa: 1 details, 2 adiados", async () => {
    await killSwitch("on");
    details.body = { imagePreview: cdn("ok.jpg") };
    for (const i of [2, 3]) await db.query("INSERT INTO public.whatsapp_conversation_summary VALUES ($1,$2,$3,$4, now())", [ORG, box(1), phone(i), `55${phone(i)}`]);
    await db.query("DELETE FROM public.whatsapp_conversation_summary WHERE instance_id <> $1", [box(1)]);
    for (const i of [1, 2, 3]) await register(i, cdn("403.jpg"), box(1));
    const rep = await run();
    expect(rep).toMatchObject({ details_calls: 1, deferred: 2, stored: 1 });
  });

  it("caixa desconectada/morta/não-uazapi → sem details (no_instance)", async () => {
    await killSwitch("on");
    await db.query("UPDATE public.whatsapp_instances SET status = 'disconnected' WHERE id = $1", [box(1)]);
    await db.query("UPDATE public.whatsapp_instances SET session_dead_since = now() WHERE id = $1", [box(2)]);
    await db.query("UPDATE public.whatsapp_instances SET provider = 'meta_cloud' WHERE id = $1", [box(3)]);
    for (const i of [1, 2, 3]) await register(i, cdn("403.jpg"));
    const rep = await run();
    expect(details.calls).toEqual([]);
    expect(rep.errors).toBe(3);
    expect((await row(1)).last_error).toMatch(/no_instance$/);
  });

  it("conversa > 30 dias: linha nem é reivindicada", async () => {
    await db.query("UPDATE public.whatsapp_conversation_summary SET last_message_time = now() - interval '31 days' WHERE normalized_phone = $1", [phone(1)]);
    await register(1, cdn("ok.jpg"));
    expect((await run()).claimed).toBe(0);
  });

  it("adiada (kill switch off) NÃO volta na rodada seguinte, o gate fica falso; candidata nova fura o recuo", async () => {
    await register(1, cdn("403.jpg"));
    expect(await gateCalls()).toBe(1);
    const r1 = await run();
    expect(r1).toMatchObject({ claimed: 1, deferred: 1 });
    expect(await row(1)).toMatchObject({ status: "pending", attempts: 0, last_error: "details_disabled" });
    const r2 = await run();
    expect(r2.claimed).toBe(0);
    expect(hits.filter((h) => h === "403.jpg")).toHaveLength(1);
    expect(await gateCalls()).toBe(0); // hora ociosa não invoca a edge fn
    // foto nova no webhook (candidate_key mudou) → pending, recuo zerado, reivindicada já
    await register(1, cdn("ok.jpg"));
    expect(await row(1)).toMatchObject({ status: "pending", retry_after: null });
    expect(await gateCalls()).toBe(1);
    const r3 = await run();
    expect(r3).toMatchObject({ claimed: 1, stored: 1 });
    expect((await row(1)).status).toBe("ok");
  });
});

describe("órfã e contato apagado", () => {
  it("conversa some → poda a linha, enfileira e drena o arquivo", async () => {
    await register(1, cdn("ok.jpg"));
    await run();
    const r = await row(1);
    await db.query("DELETE FROM public.whatsapp_conversation_summary WHERE normalized_phone = $1", [phone(1)]);
    const rep = await run();
    expect(rep.pruned_orphans).toBe(1);
    expect(await row(1)).toBeUndefined();
    // o mesmo run poda (trigger enfileira) DEPOIS de drenar → arquivo sai na próxima rodada
    expect(await queue()).toEqual([r.storage_path]);
    expect((await run()).deleted_objects).toBe(1);
    expect(bucket.size).toBe(0);
  });

  it("linha apagada entre claim e close: arquivo recém-subido vai para a fila", async () => {
    await register(1, cdn("ok.jpg"));
    const d = deps();
    const origClose = d.store.close.bind(d.store);
    d.store.close = async (rw, patch) => { await db.query("DELETE FROM public.whatsapp_contact_avatars WHERE id = $1", [rw.id]); return origClose(rw, patch); };
    await runContactAvatarSync(d);
    const q = await queue();
    expect(q).toHaveLength(1);
    expect(bucket.has(q[0])).toBe(true);
    await run();
    expect(bucket.size).toBe(0);
  });
});
