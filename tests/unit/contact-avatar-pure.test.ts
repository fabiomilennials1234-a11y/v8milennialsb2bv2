// @vitest-environment node
/**
 * Decisões puras do cron da foto do contato (_shared/contact-avatar.ts):
 * prazo `oe=`, corte de 2 MB, 0 byte, tipo pelo conteúdo, allowlist antes e
 * depois do fetch, parser tolerante do /chat/details e o UPDATE de fechamento.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AVATAR_MAX_BYTES,
  avatarStoragePath,
  avatarUrlExpired,
  closePatch,
  detailsNumber,
  downloadAvatar,
  extractDetailsImageUrl,
  readCapped,
  sha256Hex,
  sniffAvatarMime,
  type ClaimedAvatar,
} from "../../supabase/functions/_shared/contact-avatar";
import { JPEG_1PX, PNG_1PX } from "./__fixtures__/avatar-images";

const WEBP_HEAD = Uint8Array.from([...Buffer.from("RIFF"), 26, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const hexEpoch = (ms: number) => Math.floor(ms / 1000).toString(16).toUpperCase();
const cdn = (oeMs: number) => `https://pps.whatsapp.net/v/t61/1_n.jpg?ccb=11-4&oh=01_A&oe=${hexEpoch(oeMs)}`;

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
}

function response(body: Uint8Array | ReadableStream<Uint8Array> | null, init: { status?: number; url?: string; headers?: Record<string, string> } = {}) {
  const res = new Response(body as BodyInit | null, { status: init.status ?? 200, headers: init.headers });
  if (init.url !== undefined) Object.defineProperty(res, "url", { value: init.url });
  return res;
}

describe("avatarUrlExpired", () => {
  it("oe no passado (ou dentro da margem de 1 min) venceu; no futuro não", () => {
    expect(avatarUrlExpired(cdn(NOW - 1000), NOW)).toBe(true);
    expect(avatarUrlExpired(cdn(NOW + 30_000), NOW)).toBe(true);
    expect(avatarUrlExpired(cdn(NOW + 3_600_000), NOW)).toBe(false);
  });
  it("sem oe ou oe ilegível: tenta; URL quebrada: vencida", () => {
    expect(avatarUrlExpired("https://pps.whatsapp.net/a.jpg", NOW)).toBe(false);
    expect(avatarUrlExpired("https://pps.whatsapp.net/a.jpg?oe=zz", NOW)).toBe(false);
    expect(avatarUrlExpired("::", NOW)).toBe(true);
  });
});

describe("sniffAvatarMime / sha256Hex / path", () => {
  it("reconhece jpeg, png e webp pelo conteúdo", () => {
    expect(sniffAvatarMime(JPEG_1PX)).toBe("image/jpeg");
    expect(sniffAvatarMime(PNG_1PX)).toBe("image/png");
    expect(sniffAvatarMime(WEBP_HEAD)).toBe("image/webp");
  });
  it("recusa html, gif e lixo", () => {
    expect(sniffAvatarMime(Buffer.from("<html>"))).toBeNull();
    expect(sniffAvatarMime(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffAvatarMime(new Uint8Array(0))).toBeNull();
  });
  it("sha256 em hex minúsculo de 64", async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("path não carrega telefone", () => {
    expect(avatarStoragePath("org-1", "av-1")).toBe("org-1/avatars/av-1.jpg");
  });
});

describe("readCapped", () => {
  it("corta o stream acima do teto sem ler tudo", async () => {
    const big = new Uint8Array(1024 * 1024);
    const r = await readCapped(response(streamOf([big, big, big])), AVATAR_MAX_BYTES);
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });
  it("recusa pelo content-length declarado", async () => {
    const r = await readCapped(response(JPEG_1PX, { headers: { "content-length": String(AVATAR_MAX_BYTES + 1) } }), AVATAR_MAX_BYTES);
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });
  it("exatamente no teto passa", async () => {
    const r = await readCapped(response(streamOf([new Uint8Array(AVATAR_MAX_BYTES)])), AVATAR_MAX_BYTES);
    expect(r.ok && r.bytes.length).toBe(AVATAR_MAX_BYTES);
  });
});

describe("downloadAvatar", () => {
  const url = cdn(NOW + 3_600_000);

  it("jpeg ok: tipo e sha; fetch sem seguir redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(JPEG_1PX, { url }));
    const r = await downloadAvatar(url, { fetch: fetchMock });
    expect(r).toMatchObject({ kind: "ok", contentType: "image/jpeg", sha256: await sha256Hex(JPEG_1PX) });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", method: "GET" });
  });

  it("URL fora da allowlist nem chega no fetch", async () => {
    const fetchMock = vi.fn();
    expect(await downloadAvatar("https://evil.example/a.jpg", { fetch: fetchMock })).toEqual({ kind: "error", reason: "url_not_allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("URL final fora da allowlist é recusada", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(JPEG_1PX, { url: "https://evil.example/a.jpg" }));
    expect(await downloadAvatar(url, { fetch: fetchMock })).toEqual({ kind: "error", reason: "final_url_not_allowed" });
  });

  it.each([403, 404])("%s → gone (vale o fallback)", async (status) => {
    const r = await downloadAvatar(url, { fetch: vi.fn().mockResolvedValue(response(null, { status })) });
    expect(r).toEqual({ kind: "gone", reason: `http_${status}` });
  });

  it("5xx → erro, não fallback", async () => {
    const r = await downloadAvatar(url, { fetch: vi.fn().mockResolvedValue(response(null, { status: 502 })) });
    expect(r).toEqual({ kind: "error", reason: "http_502" });
  });

  it("redirect (fetch lança com redirect:error) → erro", async () => {
    const r = await downloadAvatar(url, { fetch: vi.fn().mockRejectedValue(new TypeError("redirect")) });
    expect(r).toEqual({ kind: "error", reason: "fetch_failed:TypeError" });
  });

  it("0 byte → empty; não-imagem → not_image; >2 MB → too_large", async () => {
    expect(await downloadAvatar(url, { fetch: vi.fn().mockResolvedValue(response(new Uint8Array(0))) })).toEqual({ kind: "error", reason: "empty" });
    expect(await downloadAvatar(url, { fetch: vi.fn().mockResolvedValue(response(Buffer.from("<html>oi</html>"))) })).toEqual({ kind: "error", reason: "not_image" });
    const big = response(streamOf([new Uint8Array(AVATAR_MAX_BYTES), new Uint8Array(1)]));
    expect(await downloadAvatar(url, { fetch: vi.fn().mockResolvedValue(big) })).toEqual({ kind: "error", reason: "too_large" });
  });

  it("timeout aborta", async () => {
    const hang = vi.fn((_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    expect(await downloadAvatar(url, { fetch: hang as unknown as typeof fetch, timeoutMs: 5 })).toEqual({ kind: "error", reason: "timeout" });
  });
});

describe("extractDetailsImageUrl (formato da resposta não verificado)", () => {
  const ok = "https://pps.whatsapp.net/v/t61/2_n.jpg?oe=6A000000";
  it.each([
    ["topo, imagePreview", { imagePreview: ok, image: "https://pps.whatsapp.net/full.jpg" }],
    ["topo, só image", { image: ok }],
    ["aninhado em chat", { chat: { imagePreview: ok } }],
    ["aninhado em data", { data: { image: ok } }],
    ["array", [{ imagePreview: ok }]],
  ])("%s", (_n, body) => {
    expect(extractDetailsImageUrl(body)).toEqual({ kind: "url", url: ok });
  });
  it.each([
    ["vazio", {}],
    ["campos vazios (privacidade)", { image: "", imagePreview: "" }],
    ["null", null],
    ["texto", "ok"],
  ])("%s → none", (_n, body) => {
    expect(extractDetailsImageUrl(body)).toEqual({ kind: "none" });
  });
  it("host fora da allowlist → rejected", () => {
    expect(extractDetailsImageUrl({ imagePreview: "https://evil.example/x.jpg" })).toEqual({ kind: "rejected" });
  });
});

describe("closePatch", () => {
  const row = (over: Partial<ClaimedAvatar> = {}): ClaimedAvatar => ({
    id: "a", organization_id: "o", normalized_phone: "11999990001", candidate_url: null,
    storage_path: null, content_sha256: null, status: "pending", attempts: 0,
    details_instance_id: null, details_number: null, ...over,
  });
  const at = "2026-11-24T12:00:00.000Z";
  const sha = "a".repeat(64);

  it("ok grava path e sha, zera tentativas e solta o claim", () => {
    expect(closePatch(row({ attempts: 2 }), { kind: "ok", storagePath: "o/avatars/a.jpg", sha256: sha }, at)).toEqual({
      avatar_updated_at: at, claimed_until: null, status: "ok", storage_path: "o/avatars/a.jpg", content_sha256: sha, attempts: 0, last_error: null,
    });
  });
  it("same só carimba", () => {
    expect(closePatch(row({ status: "ok" }), { kind: "same" }, at)).toEqual({
      avatar_updated_at: at, claimed_until: null, status: "ok", attempts: 0, last_error: null,
    });
  });
  it("none limpa o arquivo (o trigger enfileira)", () => {
    expect(closePatch(row({ status: "ok", storage_path: "x" }), { kind: "none" }, at)).toMatchObject({
      status: "none", storage_path: null, content_sha256: null,
    });
  });
  it("erro em pendente: 1ª e 2ª seguem pending, 3ª vira error", () => {
    expect(closePatch(row(), { kind: "error", reason: "x" }, at)).toMatchObject({ status: "pending", attempts: 1, last_error: "x" });
    expect(closePatch(row({ attempts: 1 }), { kind: "error", reason: "x" }, at)).toMatchObject({ status: "pending", attempts: 2 });
    expect(closePatch(row({ attempts: 2 }), { kind: "error", reason: "x" }, at)).toMatchObject({ status: "error", attempts: 3 });
  });
  it("erro na revisita de foto ok mantém a foto", () => {
    const p = closePatch(row({ status: "ok", attempts: 5 }), { kind: "error", reason: "x" }, at);
    expect(p).toMatchObject({ status: "ok", attempts: 6 });
    expect(p).not.toHaveProperty("storage_path");
  });
  it("deferred não conta tentativa nem muda estado", () => {
    expect(closePatch(row({ attempts: 1 }), { kind: "deferred", reason: "details_cap" }, at)).toEqual({
      avatar_updated_at: at, claimed_until: null, last_error: "details_cap",
    });
  });
});

describe("detailsNumber", () => {
  it("usa o telefone cru da conversa; senão 55 + normalizado", () => {
    expect(detailsNumber({ details_number: "+55 (11) 99999-0001", normalized_phone: "11999990001" })).toBe("5511999990001");
    expect(detailsNumber({ details_number: null, normalized_phone: "11999990001" })).toBe("5511999990001");
    expect(detailsNumber({ details_number: "", normalized_phone: "351912345678" })).toBe("351912345678");
  });
});
