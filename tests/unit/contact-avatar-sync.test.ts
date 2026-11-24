// @vitest-environment node
/**
 * Rodada do cron contact-avatar-sync (supabase/functions/contact-avatar-sync).
 *
 * `runContactAvatarSync` com um store em memória, CDN dublado devolvendo
 * imagens reais (1×1 JPEG/PNG) e o /chat/details dublado com corpos no formato
 * PRESUMIDO (falta fixture real — ver Aberto no PR). Cobre teto/jitter do
 * fallback, escolha da caixa, kill switch, UPDATE de 0 linhas, a fila de
 * remoção, o adaptador supabase-js e o 401 do index.ts.
 */
import "../helpers/deno-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAIM_BATCH,
  DETAILS_CAP_PER_RUN,
  runContactAvatarSync,
  supabaseAvatarStore,
  type AvatarStore,
  type SupabaseLike,
  type SyncDeps,
} from "../../supabase/functions/contact-avatar-sync/sync";
import { sha256Hex, type ClaimedAvatar } from "../../supabase/functions/_shared/contact-avatar";
import { JPEG_1PX, PNG_1PX } from "./__fixtures__/avatar-images";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const hex = (ms: number) => Math.floor(ms / 1000).toString(16);
const FRESH = (n: number) => `https://pps.whatsapp.net/v/t61/${n}_n.jpg?ccb=11-4&oh=01_A&oe=${hex(NOW + 86_400_000)}`;
const EXPIRED = (n: number) => `https://pps.whatsapp.net/v/t61/${n}_n.jpg?ccb=11-4&oh=01_A&oe=${hex(NOW - 1000)}`;
const DETAILS_URL = (n: number) => `https://pps.whatsapp.net/v/t61/${n}_details.jpg?oe=${hex(NOW + 86_400_000)}`;
const ORG = "00000000-0000-4000-8000-000000000001";

function claimed(n: number, over: Partial<ClaimedAvatar> = {}): ClaimedAvatar {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    organization_id: ORG,
    normalized_phone: `1199999${String(n).padStart(4, "0")}`,
    candidate_url: FRESH(n),
    storage_path: null,
    content_sha256: null,
    status: "pending",
    attempts: 0,
    details_instance_id: `box-${n}`,
    details_number: `551199999${String(n).padStart(4, "0")}`,
    ...over,
  };
}

/** Store em memória que registra tudo o que a rodada pediu. */
function memoryStore(batches: ClaimedAvatar[][], opts: { queue?: string[]; live?: string[]; detailsEnabled?: boolean | Error; vanished?: string[] } = {}) {
  const calls = {
    removed: [] as string[], dequeued: [] as string[], enqueued: [] as string[],
    uploads: [] as Array<{ path: string; contentType: string; size: number }>,
    closes: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    released: [] as string[], tokens: [] as string[], pruned: 0, excludes: [] as string[][],
  };
  const store: AvatarStore = {
    listDeletionQueue: async () => opts.queue ?? [],
    liveStoragePaths: async (paths) => new Set(paths.filter((p) => (opts.live ?? []).includes(p))),
    removeObjects: async (paths) => void calls.removed.push(...paths),
    dequeueDeletions: async (paths) => void calls.dequeued.push(...paths),
    enqueueDeletion: async (path) => void calls.enqueued.push(path),
    pruneOrphans: async () => (calls.pruned += 1, 0),
    claim: async (_limit, exclude) => (calls.excludes.push([...exclude]), batches.shift() ?? []),
    close: async (row, patch) => {
      calls.closes.push({ id: row.id, patch });
      return (opts.vanished ?? []).includes(row.id) ? 0 : 1;
    },
    releaseClaims: async (ids) => void calls.released.push(...ids),
    upload: async (path, bytes, contentType) => void calls.uploads.push({ path, contentType, size: bytes.length }),
    instanceToken: async (instanceId) => (calls.tokens.push(instanceId), `token-${instanceId}`),
    detailsEnabled: async () => {
      if (opts.detailsEnabled instanceof Error) throw opts.detailsEnabled;
      return opts.detailsEnabled ?? true;
    },
  };
  return { store, calls };
}

/** CDN dublado: URL → corpo. O que não está no mapa é 403 (URL vencida). */
function cdn(bodies: Record<string, Uint8Array>) {
  return vi.fn(async (url: string) => {
    const body = bodies[url];
    const res = body ? new Response(body, { status: 200 }) : new Response(null, { status: 403 });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as unknown as typeof fetch;
}

function deps(store: AvatarStore, fetchImpl: typeof fetch, details: (instanceId: string, number: string) => unknown = () => ({})) {
  const sleeps: number[] = [];
  const detailCalls: Array<{ token: string; instanceId: string; number: string; preview: boolean }> = [];
  const logs: Array<{ action: string; payload: Record<string, unknown> }> = [];
  let clock = NOW;
  const d: SyncDeps = {
    store,
    fetch: fetchImpl,
    detailsClient: (token, instanceId) => ({
      chatDetails: async (number, preview) => {
        detailCalls.push({ token, instanceId, number, preview });
        return details(instanceId, number);
      },
    }),
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock,
    random: () => 0.5,
    log: (action, payload) => void logs.push({ action, payload }),
  };
  return { d, sleeps, detailCalls, logs };
}

describe("runContactAvatarSync", () => {
  it("candidata válida: baixa, sobe no path da linha com o tipo detectado e fecha ok", async () => {
    const row = claimed(1);
    const { store, calls } = memoryStore([[row]]);
    const { d, detailCalls } = deps(store, cdn({ [FRESH(1)]: JPEG_1PX }));
    const report = await runContactAvatarSync(d);
    expect(calls.uploads).toEqual([{ path: `${ORG}/avatars/${row.id}.jpg`, contentType: "image/jpeg", size: JPEG_1PX.length }]);
    expect(calls.closes[0].patch).toMatchObject({
      status: "ok", storage_path: `${ORG}/avatars/${row.id}.jpg`, content_sha256: await sha256Hex(JPEG_1PX), claimed_until: null,
    });
    expect(calls.dequeued).toEqual([`${ORG}/avatars/${row.id}.jpg`]);
    expect(detailCalls).toEqual([]);
    expect(report).toMatchObject({ claimed: 1, stored: 1, details_calls: 0 });
  });

  it("sha igual ao gravado: não sobe, só carimba", async () => {
    const row = claimed(1, { status: "ok", storage_path: `${ORG}/avatars/x.jpg`, content_sha256: await sha256Hex(PNG_1PX) });
    const { store, calls } = memoryStore([[row]]);
    const report = await runContactAvatarSync(deps(store, cdn({ [FRESH(1)]: PNG_1PX })).d);
    expect(calls.uploads).toEqual([]);
    expect(calls.closes[0].patch).toMatchObject({ status: "ok", attempts: 0 });
    expect(calls.closes[0].patch).not.toHaveProperty("storage_path");
    expect(report.unchanged).toBe(1);
  });

  it("oe vencido: não toca o CDN com a URL velha, vai ao /chat/details pela caixa elegível", async () => {
    const row = claimed(1, { candidate_url: EXPIRED(1), details_instance_id: "box-A", details_number: "5511999990001" });
    const { store, calls } = memoryStore([[row]]);
    const fetchImpl = cdn({ [DETAILS_URL(1)]: JPEG_1PX });
    const { d, detailCalls, logs } = deps(store, fetchImpl, () => ({ imagePreview: DETAILS_URL(1), image: "" }));
    await runContactAvatarSync(d);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([DETAILS_URL(1)]);
    expect(detailCalls).toEqual([{ token: "token-box-A", instanceId: "box-A", number: "5511999990001", preview: true }]);
    expect(calls.closes[0].patch).toMatchObject({ status: "ok" });
    expect(logs).toEqual([{ action: "contact_avatar_details_call", payload: { calls: 1, by_instance: { "box-A": 1 } } }]);
  });

  it("403 do CDN cai no fallback", async () => {
    const { store, calls } = memoryStore([[claimed(1)]]);
    const { d, detailCalls } = deps(store, cdn({ [DETAILS_URL(1)]: PNG_1PX }), () => ({ chat: { image: DETAILS_URL(1) } }));
    await runContactAvatarSync(d);
    expect(detailCalls).toHaveLength(1);
    expect(calls.uploads[0].contentType).toBe("image/png");
  });

  it(`teto de ${DETAILS_CAP_PER_RUN} chamadas por rodada, com jitter de 2–4 s entre elas`, async () => {
    const rows = Array.from({ length: 7 }, (_, i) => claimed(i + 1, { candidate_url: null }));
    const { store, calls } = memoryStore([rows]);
    const { d, detailCalls, sleeps } = deps(store, cdn({}), () => ({ image: "" }));
    const report = await runContactAvatarSync(d);
    expect(detailCalls).toHaveLength(DETAILS_CAP_PER_RUN);
    expect(sleeps).toHaveLength(DETAILS_CAP_PER_RUN - 1);
    for (const ms of sleeps) {
      expect(ms).toBeGreaterThanOrEqual(2000);
      expect(ms).toBeLessThan(4000);
    }
    expect(report).toMatchObject({ none: 5, deferred: 2, details_calls: 5 });
    expect(calls.closes.slice(5).map((c) => c.patch)).toEqual([
      expect.objectContaining({ last_error: "details_cap" }), expect.objectContaining({ last_error: "details_cap" }),
    ]);
    expect(calls.closes[5].patch).not.toHaveProperty("attempts");
  });

  it("no máximo 1 chamada por caixa por rodada; token lido uma vez por caixa", async () => {
    const rows = [1, 2, 3].map((n) => claimed(n, { candidate_url: null, details_instance_id: "box-A" }));
    const { store, calls } = memoryStore([rows]);
    const { d, detailCalls } = deps(store, cdn({}), () => ({ image: "" }));
    const report = await runContactAvatarSync(d);
    expect(detailCalls).toHaveLength(1);
    expect(calls.tokens).toEqual(["box-A"]);
    expect(report).toMatchObject({ none: 1, deferred: 2 });
  });

  it("sem caixa elegível (desconectada/morta/sem conversa): erro, sem chamada", async () => {
    const { store, calls } = memoryStore([[claimed(1, { candidate_url: EXPIRED(1), details_instance_id: null })]]);
    const { d, detailCalls } = deps(store, cdn({}));
    await runContactAvatarSync(d);
    expect(detailCalls).toEqual([]);
    expect(calls.closes[0].patch).toMatchObject({ status: "pending", attempts: 1, last_error: "candidate_expired;no_instance" });
  });

  it.each([
    ["desligado", false],
    ["ilegível (falha fechada)", new Error("db")],
  ])("kill switch %s: zero chamadas, linha adiada", async (_n, flag) => {
    const { store, calls } = memoryStore([[claimed(1, { candidate_url: null })]], { detailsEnabled: flag });
    const { d, detailCalls } = deps(store, cdn({}), () => ({ image: DETAILS_URL(1) }));
    await runContactAvatarSync(d);
    expect(detailCalls).toEqual([]);
    expect(calls.closes[0].patch).toMatchObject({ last_error: "details_disabled" });
  });

  it("sem foto no /chat/details → none e path nulo (trigger enfileira o antigo)", async () => {
    const row = claimed(1, { candidate_url: null, status: "ok", storage_path: `${ORG}/avatars/x.jpg`, content_sha256: "a".repeat(64) });
    const { store, calls } = memoryStore([[row]]);
    await runContactAvatarSync(deps(store, cdn({}), () => ({ imagePreview: "", image: "" })).d);
    expect(calls.closes[0].patch).toMatchObject({ status: "none", storage_path: null, content_sha256: null });
  });

  it.each([
    ["{}", {}],
    ["{ error }", { error: "not found" }],
    ["não-objeto", "ok"],
  ])("foto ok + /chat/details com formato desconhecido (%s): mantém a foto", async (_n, body) => {
    const row = claimed(1, { candidate_url: null, status: "ok", storage_path: `${ORG}/avatars/x.jpg`, content_sha256: "a".repeat(64) });
    const { store, calls } = memoryStore([[row]]);
    await runContactAvatarSync(deps(store, cdn({}), () => body).d);
    const patch = calls.closes[0].patch;
    expect(patch).toMatchObject({ status: "ok", last_error: "details_shape_unknown", attempts: 1 });
    expect(patch).not.toHaveProperty("storage_path");
    expect(patch).not.toHaveProperty("content_sha256");
  });

  it("URL do /chat/details fora da allowlist: não baixa", async () => {
    const fetchImpl = cdn({});
    const { store, calls } = memoryStore([[claimed(1, { candidate_url: null })]]);
    await runContactAvatarSync(deps(store, fetchImpl, () => ({ image: "https://evil.example/a.jpg" })).d);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls.closes[0].patch).toMatchObject({ last_error: "details_url_rejected", attempts: 1 });
  });

  it("provedor falhou: erro com status, sem retry", async () => {
    const { store, calls } = memoryStore([[claimed(1, { candidate_url: null })]]);
    const { d, detailCalls } = deps(store, cdn({}), () => { throw { status: 429 }; });
    await runContactAvatarSync(d);
    expect(detailCalls).toHaveLength(1);
    expect(calls.closes[0].patch).toMatchObject({ last_error: "details_failed_429" });
  });

  it("UPDATE de 0 linhas (apagada no meio): o arquivo recém-subido vai para a fila", async () => {
    const row = claimed(1);
    const { store, calls } = memoryStore([[row]], { vanished: [row.id] });
    await runContactAvatarSync(deps(store, cdn({ [FRESH(1)]: JPEG_1PX })).d);
    expect(calls.enqueued).toEqual([`${ORG}/avatars/${row.id}.jpg`]);
    expect(calls.dequeued).toEqual([]);
  });

  it("fila de remoção: apaga o que não é arquivo vivo e esvazia a fila; poda órfãs", async () => {
    const { store, calls } = memoryStore([], { queue: ["o/avatars/a.jpg", "o/avatars/b.jpg"], live: ["o/avatars/b.jpg"] });
    const report = await runContactAvatarSync(deps(store, cdn({})).d);
    expect(calls.removed).toEqual(["o/avatars/a.jpg"]);
    expect(calls.dequeued).toEqual(["o/avatars/a.jpg", "o/avatars/b.jpg"]);
    expect(calls.pruned).toBe(1);
    expect(report.deleted_objects).toBe(1);
  });

  it("lotes seguintes da rodada excluem os ids já vistos (adiada não volta)", async () => {
    const full = Array.from({ length: CLAIM_BATCH }, (_, i) => claimed(i + 1, { candidate_url: null, details_instance_id: "box-A" }));
    const { store, calls } = memoryStore([full, []]);
    await runContactAvatarSync(deps(store, cdn({}), () => ({ image: "" })).d);
    expect(calls.excludes[0]).toEqual([]);
    expect(calls.excludes[1]).toEqual(full.map((r) => r.id));
  });

  it("reivindica lotes cheios em sequência e para no lote incompleto", async () => {
    const full = Array.from({ length: CLAIM_BATCH }, (_, i) => claimed(i + 1));
    const bodies = Object.fromEntries(full.map((r, i) => [FRESH(i + 1), JPEG_1PX]));
    const { store } = memoryStore([full, [claimed(99, { candidate_url: FRESH(99) })], [claimed(100)]]);
    const report = await runContactAvatarSync(deps(store, cdn({ ...bodies, [FRESH(99)]: JPEG_1PX })).d);
    expect(report.claimed).toBe(CLAIM_BATCH + 1);
  });

  it("orçamento estourado: solta o claim do resto do lote", async () => {
    const rows = [1, 2, 3].map((n) => claimed(n, { candidate_url: null, details_instance_id: `box-${n}` }));
    const { store, calls } = memoryStore([rows]);
    const { d } = deps(store, cdn({}), () => ({}));
    let t = NOW;
    d.now = () => (t += 20_000);
    await runContactAvatarSync(d);
    expect(calls.released.length).toBeGreaterThan(0);
    expect(calls.closes.length + calls.released.length).toBe(3);
  });
});

// ── Adaptador supabase-js ────────────────────────────────────────────────────
/** Dublê de cadeia que grava cada chamada e devolve o corpo programado no await. */
function recordingClient(results: Record<string, unknown> = {}) {
  const log: string[] = [];
  const chain = (prefix: string): unknown => new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === "then") {
        const data = results[prefix] ?? null;
        return (resolve: (v: unknown) => void) => resolve({ data, error: null });
      }
      return (...args: unknown[]) => {
        log.push(`${prefix}.${String(prop)}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return chain(prefix);
      };
    },
  });
  const client = {
    from: (table: string) => { log.push(`from(${table})`); return chain(table); },
    rpc: async (fn: string, args: unknown) => { log.push(`rpc(${fn},${JSON.stringify(args)})`); return { data: results[`rpc:${fn}`] ?? null, error: null }; },
    storage: { from: (bucket: string) => { log.push(`storage(${bucket})`); return chain(`storage:${bucket}`); } },
  } as unknown as SupabaseLike;
  return { client, log };
}

describe("supabaseAvatarStore", () => {
  it("fecha por id E organização e conta as linhas devolvidas", async () => {
    const { client, log } = recordingClient({ whatsapp_contact_avatars: [{ id: "a" }] });
    const n = await supabaseAvatarStore(client).close(claimed(1), { status: "ok" });
    expect(n).toBe(1);
    expect(log).toEqual([
      "from(whatsapp_contact_avatars)",
      'whatsapp_contact_avatars.update({"status":"ok"})',
      `whatsapp_contact_avatars.eq("id","${claimed(1).id}")`,
      `whatsapp_contact_avatars.eq("organization_id","${ORG}")`,
      'whatsapp_contact_avatars.select("id")',
    ]);
  });

  it("token pela caixa E organização; kill switch só liga com 'on' explícito", async () => {
    const { client, log } = recordingClient({ whatsapp_instance_secrets: { uazapi_token: "t" } });
    const store = supabaseAvatarStore(client);
    expect(await store.instanceToken("box", ORG)).toBe("t");
    expect(log).toContain(`whatsapp_instance_secrets.eq("organization_id","${ORG}")`);
    // ausente = DESLIGADO até existir fixture real do /chat/details
    expect(await store.detailsEnabled()).toBe(false);
    expect(await supabaseAvatarStore(recordingClient({ cron_config: { value: "off" } }).client).detailsEnabled()).toBe(false);
    expect(await supabaseAvatarStore(recordingClient({ cron_config: { value: " ON " } }).client).detailsEnabled()).toBe(true);
  });

  it("upload upsert com tipo detectado e cache de 1 h no bucket privado", async () => {
    const { client, log } = recordingClient();
    await supabaseAvatarStore(client).upload("o/avatars/a.jpg", JPEG_1PX, "image/jpeg");
    expect(log[0]).toBe("storage(contact-avatars)");
    expect(log[1]).toMatch(/^storage:contact-avatars\.upload\("o\/avatars\/a\.jpg",.*\{"contentType":"image\/jpeg","cacheControl":"3600","upsert":true\}\)$/);
  });

  it("RPCs de service_role com os nomes da migration", async () => {
    const { client, log } = recordingClient({ "rpc:reivindicar_avatares": [claimed(1)], "rpc:podar_avatares_orfaos": 3 });
    const store = supabaseAvatarStore(client);
    expect(await store.claim(25, ["a"])).toHaveLength(1);
    expect(await store.pruneOrphans(200)).toBe(3);
    expect(log).toEqual(['rpc(reivindicar_avatares,{"p_limit":25,"p_exclude":["a"]})', 'rpc(podar_avatares_orfaos,{"p_limit":200})']);
  });
});

// ── index.ts: autenticação ───────────────────────────────────────────────────
describe("contact-avatar-sync index.ts", () => {
  type Handler = (req: Request) => Promise<Response>;
  let handler: Handler;

  beforeEach(async () => {
    vi.resetModules();
    const denoGlobal = (globalThis as unknown as { Deno: { serve: unknown; env: { set(k: string, v: string): void; delete(k: string): void } } }).Deno;
    denoGlobal.serve = (fn: Handler) => { handler = fn; };
    vi.doMock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => { throw new Error("não deveria criar cliente"); } }));
    vi.doMock("../../supabase/functions/_shared/error-boundary.ts", () => ({ withErrorBoundary: (_n: string, fn: unknown) => fn }));
    vi.doMock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: vi.fn() }));
    await import("../../supabase/functions/contact-avatar-sync/index.ts");
  });

  const post = (headers: Record<string, string> = {}) =>
    handler(new Request("https://x.supabase.co/functions/v1/contact-avatar-sync", { method: "POST", headers }));

  it("401 sem segredo configurado, sem header e com header errado", async () => {
    const env = (globalThis as unknown as { Deno: { env: { set(k: string, v: string): void; delete(k: string): void } } }).Deno.env;
    env.delete("CRON_SECRET");
    expect((await post({ "x-cron-secret": "" })).status).toBe(401);
    env.set("CRON_SECRET", "s3cret");
    expect((await post()).status).toBe(401);
    expect((await post({ "x-cron-secret": "s3cre" })).status).toBe(401);
    expect((await post({ authorization: "Bearer s3cret" })).status).toBe(401);
  });

  it("GET é 405", async () => {
    const res = await handler(new Request("https://x.supabase.co/functions/v1/contact-avatar-sync", { method: "GET" }));
    expect(res.status).toBe(405);
  });
});
