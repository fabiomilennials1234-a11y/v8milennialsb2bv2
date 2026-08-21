/**
 * Trava do contrato HOSTIL do NotificaMe — sem rede e sem conta viva.
 *
 * É a única defesa contra o modo de falha caro desta fatia: gravar em
 * `whatsapp_instances` um canal que nunca existiu, porque o fornecedor devolveu
 * HTTP 200 com um erro dentro. Todos os corpos abaixo foram PROVADOS contra a
 * conta real em 2027-08-13.
 *
 * O controle negativo está espalhado de propósito: o caso Hub404 é um **200** e
 * o caso de autenticação é um **404**. Uma implementação que passasse a olhar
 * `res.ok` reprovaria nos dois, em direções opostas.
 */
import { describe, it, expect } from "vitest";
import {
  NotificameError,
  NOTIFICAME_DEFAULT_BASE_URL,
  buildSeamlessStartUrl,
  parseNotificameBody,
  normalizeChannel,
  listChannels,
  readClaimedChannelId,
  type NotificameOrgConfig,
  type FetchImpl,
} from "../../supabase/functions/_shared/notificame";

// ── helpers ──────────────────────────────────────────────────────────────────

// Config de ORG: sob subconta-por-org, quem fala com `/v1/channels` é o token da
// SUBCONTA, nunca o da conta-mãe. O nome da constante mantém a palavra "SUBCONTA"
// à vista de propósito — se um dia alguém trocar isto pelo token do pai, o teste
// de não-vazamento ao lado é que precisa gritar.
const cfg: NotificameOrgConfig = {
  baseUrl: NOTIFICAME_DEFAULT_BASE_URL,
  subaccountToken: "TOKEN_DA_SUBCONTA",
};

/** fetch fake: devolve texto + status arbitrários, e grava a chamada recebida. */
function fetchReturning(body: string, status: number): FetchImpl & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response(body, { status }));
  }) as FetchImpl & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

function envOf(vars: Record<string, string | undefined>) {
  return { get: (k: string) => vars[k] };
}

// ── buildSeamlessStartUrl ────────────────────────────────────────────────────

describe("buildSeamlessStartUrl", () => {
  it("monta a URL do popup com type=whatsapp por padrão", () => {
    const url = buildSeamlessStartUrl({
      baseUrl: NOTIFICAME_DEFAULT_BASE_URL,
      companyUuid: "abc-123",
      redirectOrigin: "https://torquecrm.com.br",
    });
    expect(url).toBe(
      "https://api.notificame.com.br/v2/oauth/meta/start" +
        "?company_uuid=abc-123&redirect_origin=https%3A%2F%2Ftorquecrm.com.br&type=whatsapp",
    );
  });

  it("encoda a origem — separadores nunca escapam para a querystring", () => {
    const url = buildSeamlessStartUrl({
      baseUrl: NOTIFICAME_DEFAULT_BASE_URL,
      companyUuid: "abc",
      redirectOrigin: "https://evil.example/?x=1&y=2",
    });
    expect(url).toContain("redirect_origin=https%3A%2F%2Fevil.example%2F%3Fx%3D1%26y%3D2");
    // a origem injetada não pode virar um parâmetro de verdade
    expect(url.split("&").length).toBe(3);
  });

  it("aceita type=instagram (fatia 1 fixa whatsapp, mas o contrato suporta)", () => {
    const url = buildSeamlessStartUrl({
      baseUrl: NOTIFICAME_DEFAULT_BASE_URL,
      companyUuid: "abc",
      redirectOrigin: "https://torquecrm.com.br",
      type: "instagram",
    });
    expect(url.endsWith("&type=instagram")).toBe(true);
  });
});

// ── parseNotificameBody ──────────────────────────────────────────────────────

describe("parseNotificameBody", () => {
  it("texto puro do ServeMux do Go vira código, não SyntaxError", () => {
    const r = parseNotificameBody("404 page not found\n");
    expect(r).toEqual({ ok: false, code: "non_json_response" });
  });

  it("envelope de erro do Graph (Hub404) vira o código da Meta", () => {
    const r = parseNotificameBody('{"error":{"type":"OAuthException","code":"Hub404"}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("Hub404");
  });

  it("envelope de erro sem code cai em upstream_error", () => {
    const r = parseNotificameBody('{"error":{"type":"OAuthException"}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("upstream_error");
  });

  it("code != SUCCESS é erro", () => {
    const r = parseNotificameBody('{"code":"ERROR","message":"company não é revenda"}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("ERROR");
      expect(r.message).toBe("company não é revenda");
    }
  });

  it("code SUCCESS é sucesso", () => {
    const r = parseNotificameBody('{"code":"SUCCESS","value":{"id":"c1"}}');
    expect(r.ok).toBe(true);
  });

  it("array puro é sucesso — não tem envelope nenhum", () => {
    const r = parseNotificameBody("[]");
    expect(r).toEqual({ ok: true, value: [] });
  });
});

// ── listChannels — as 4 armadilhas ───────────────────────────────────────────

describe("listChannels", () => {
  it("(a) HTTP 200 com corpo Hub404 REJEITA — res.ok mentiria", async () => {
    const f = fetchReturning('{"error":{"type":"OAuthException","code":"Hub404"}}', 200);
    await expect(listChannels(cfg, f)).rejects.toBeInstanceOf(NotificameError);
    await expect(listChannels(cfg, f)).rejects.toMatchObject({ code: "Hub404" });
  });

  it("(b) HTTP 404 com AUTHENTICATION_ERROR rejeita com esse código (não é 401)", async () => {
    const f = fetchReturning('{"code":"AUTHENTICATION_ERROR"}', 404);
    await expect(listChannels(cfg, f)).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });

  it("(c) HTTP 200 com texto puro rejeita como non_json_response, sem vazar SyntaxError", async () => {
    const f = fetchReturning("404 page not found\n", 200);
    await expect(listChannels(cfg, f)).rejects.toMatchObject({
      name: "NotificameError",
      code: "non_json_response",
    });
  });

  it("(d) HTTP 422 com code ERROR rejeita com ERROR", async () => {
    const f = fetchReturning('{"code":"ERROR","message":"company não é revenda"}', 422);
    await expect(listChannels(cfg, f)).rejects.toMatchObject({ code: "ERROR" });
  });

  it("(e) HTTP 200 com [] resolve vazio — o estado de hoje na conta viva", async () => {
    const f = fetchReturning("[]", 200);
    await expect(listChannels(cfg, f)).resolves.toEqual([]);
  });

  it("(f) lista com um canal resolve normalizado", async () => {
    const f = fetchReturning(
      JSON.stringify([{ id: "ch_1", name: " Comercial ", phone: "+55 11 98888-7777", type: "whatsapp", status: "active" }]),
      200,
    );
    await expect(listChannels(cfg, f)).resolves.toEqual([
      { id: "ch_1", name: "Comercial", phone: "+55 11 98888-7777", type: "whatsapp", status: "active" },
    ]);
  });

  it("shape inesperado (objeto no lugar de array) rejeita com unexpected_shape", async () => {
    const f = fetchReturning('{"data":[]}', 200);
    await expect(listChannels(cfg, f)).rejects.toMatchObject({ code: "unexpected_shape" });
  });

  it("manda o token no header X-Api-Token e em nenhum outro lugar", async () => {
    const f = fetchReturning("[]", 200);
    await listChannels(cfg, f);
    const call = f.calls[0];
    expect(call.url).toBe("https://api.notificame.com.br/v1/channels");
    expect(call.url).not.toContain(cfg.subaccountToken);
    expect((call.init?.headers as Record<string, string>)["X-Api-Token"]).toBe(cfg.subaccountToken);
  });

  it("a mensagem do erro lançado NUNCA carrega o token nem o corpo do fornecedor", async () => {
    const f = fetchReturning('{"code":"ERROR","message":"segredo interno do fornecedor"}', 200);
    await expect(listChannels(cfg, f)).rejects.toSatisfy((e: unknown) => {
      const msg = (e as Error).message;
      return !msg.includes(cfg.subaccountToken) && !msg.includes("segredo interno do fornecedor");
    });
  });
});

// ── normalizeChannel ─────────────────────────────────────────────────────────

describe("normalizeChannel", () => {
  it("aceita os aliases de id, telefone e nome", () => {
    expect(normalizeChannel({ uuid: "u1", number: "5511988887777", title: "Vendas" })).toEqual({
      id: "u1",
      name: "Vendas",
      phone: "5511988887777",
      type: null,
      status: null,
    });
    expect(normalizeChannel({ channel_id: "c2", phone_number: "551199" })?.id).toBe("c2");
  });

  it("descarta item sem id — vincular canal sem id é vincular nada", () => {
    expect(normalizeChannel({ name: "sem id" })).toBeNull();
    expect(normalizeChannel(null)).toBeNull();
    expect(normalizeChannel("ch_1")).toBeNull();
  });
});
// ── readClaimedChannelId ─────────────────────────────────────────────────────

describe("readClaimedChannelId", () => {
  it("extrai o channel_id de um provider_config vindo do banco", () => {
    expect(readClaimedChannelId({ vendor: "notificame", channel_id: "ch_1" })).toBe("ch_1");
  });

  it("devolve null para config vazio, nulo ou sem channel_id", () => {
    expect(readClaimedChannelId({})).toBeNull();
    expect(readClaimedChannelId(null)).toBeNull();
    expect(readClaimedChannelId({ channel_id: "" })).toBeNull();
    expect(readClaimedChannelId("ch_1")).toBeNull();
  });
});
