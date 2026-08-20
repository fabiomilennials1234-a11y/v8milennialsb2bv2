// @vitest-environment node
/**
 * NotificameProvider — o caminho de ENVIO do canal oficial.
 *
 * ESTE ARQUIVO NASCE PORQUE NÃO HAVIA NENHUM. O provider de envio foi construído
 * nesta rodada (`_shared/whatsapp-providers/notificame-provider.ts`, 889 linhas)
 * e nenhum teste do repo o importava — `grep -rln NotificameProvider tests/`
 * devolvia vazio. Tudo abaixo é cobertura nova.
 *
 * O QUE ELE MEDE, e por que é diferente de um teste de "o envio funciona":
 *
 *   1. VEREDITO PELO CORPO, NUNCA POR `res.ok`/`res.status`. Está PROVADO contra
 *      a conta viva que o fornecedor devolve HTTP **200** com `Hub404` dentro
 *      quando a rota é desconhecida, e HTTP **404** com `AUTHENTICATION_ERROR`
 *      quando a auth falha. As duas direções erram. Por isso os casos de erro
 *      abaixo mandam status que CONTRADIZ o corpo: um provider que lesse status
 *      passaria no teste feliz e falharia exatamente nestes.
 *
 *   2. O ID É O VEREDITO. Sem id legível na resposta, o envio FALHA e nada é
 *      gravado. O antipadrão que este provider recusa (`external_id: id || \`meta_${Date.now()}\``
 *      em `send-meta-message`) passaria num teste que só olhasse "gravou a linha".
 *      Por isso o caso do id ausente cobra as DUAS coisas: o throw E a ausência
 *      de escrita.
 *
 *   3. A CREDENCIAL É A DA SUBCONTA, e ela é buscada POR `organization_id`.
 *      O caso de `subaccount_mismatch` é o teste do vetor cross-tenant: um
 *      `provider_config.subaccount_id` adulterado não pode escolher o cofre de
 *      outra org.
 *
 * Sem rede: `fetchImpl` é injetado e o cofre é semeado com crypto REAL
 * (round-trip por `encryptSecret`), não com um placeholder que o decifrador
 * rejeitaria — dublê mais frouxo que o real é como um teste destes vira
 * decorativo.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Deno.env, exigido pelos módulos de `_shared/` ────────────────────────────
const ENC_KEY = "b".repeat(64);
const denoEnv: Record<string, string | undefined> = {
  NOTIFICAME_ENCRYPTION_KEY: ENC_KEY,
  NOTIFICAME_BASE_URL: "https://hub.notificame.example",
  SUPABASE_URL: "http://localhost",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};
if (typeof (globalThis as Record<string, unknown>).Deno === "undefined") {
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: { get: (k: string) => denoEnv[k], set: (k: string, v: string) => (denoEnv[k] = v) },
  };
}

const { NotificameProvider, readSentMessageId, notificameSendPath } = await import(
  "../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts"
);
const { encryptSecret } = await import("../../supabase/functions/_shared/crypto");

// ── fixtures ─────────────────────────────────────────────────────────────────

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const SUB_ROW_ID = "sub-row-1";
/** O CompanyId da subconta — sob revenda, ELE É o token da org. */
const SUB_TOKEN = "33333333-3333-4333-8333-333333333333";
/** O id do CANAL no fornecedor. Vira `from`. NÃO é telefone, NÃO é a subconta. */
const CHANNEL_ID = "ch_wa_123";
const BASE = "https://hub.notificame.example";

/** Rota desconhecida: HTTP **200** com envelope de erro do Graph dentro. */
const HUB404 = '{"error":{"type":"OAuthException","code":"Hub404"}}';
/** Falha de auth: HTTP **404** com o código dentro. */
const AUTH_ERR = '{"code":"AUTHENTICATION_ERROR","message":"invalid token"}';
/** Sucesso com id real. */
const SENT_OK = '{"id":"wamid.ABC123"}';

// ── dublê de banco: cofre + trilha de escrita em channel_messages ────────────

interface Written {
  table: string;
  row: Record<string, unknown>;
  onConflict?: string;
}

function makeAdmin(opts: { subaccount?: Record<string, unknown> | null; upsertError?: string } = {}) {
  const written: Written[] = [];
  const sub = opts.subaccount;

  const client = {
    from(table: string) {
      if (table === "notificame_subaccounts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: sub ?? null, error: null }),
              }),
            }),
          }),
        };
      }
      return {
        upsert: (row: Record<string, unknown>, o?: { onConflict?: string }) => {
          written.push({ table, row, onConflict: o?.onConflict });
          return Promise.resolve({
            error: opts.upsertError ? { message: opts.upsertError } : null,
          });
        },
      };
    },
  };

  return { client, written };
}

/** Semeia a linha do cofre com cifragem REAL — round-trip, não placeholder. */
async function readySubaccount(token = SUB_TOKEN, id = SUB_ROW_ID) {
  const enc = await (encryptSecret as (p: string, k: string) => Promise<{ ciphertext: string; nonce: string }>)(
    token,
    ENC_KEY,
  );
  return {
    id,
    organization_id: ORG,
    status: "ready",
    company_uuid_ciphertext: enc.ciphertext,
    company_uuid_nonce: enc.nonce,
  };
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** fetch que devolve `[status, body]` na ordem, e registra tudo. */
function makeFetch(responses: Array<[number, string]>) {
  const calls: FetchCall[] = [];
  const impl = (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const [status, body] = responses.shift() ?? [200, SENT_OK];
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    } as unknown as Response);
  };
  return { impl, calls };
}

async function makeProvider(
  over: Record<string, unknown> = {},
  fetchResponses: Array<[number, string]> = [[200, SENT_OK]],
) {
  const admin = makeAdmin({
    // `in`, e não `??`: o caso "cofre vazio" passa `subaccount: null` DE
    // PROPÓSITO, e `??` o trataria como "não informado", semeando uma subconta
    // pronta e medindo o oposto do que o caso pede.
    subaccount: "subaccount" in over
      ? (over.subaccount as Record<string, unknown> | null)
      : await readySubaccount(),
    upsertError: over.upsertError as string | undefined,
  });
  const f = makeFetch(fetchResponses);
  const provider = new (NotificameProvider as new (o: Record<string, unknown>) => {
    sendText(o: { number: string; text: string }): Promise<{ message_id: string; status: string }>;
  })({
    organizationId: ORG,
    channelId: CHANNEL_ID,
    channelKind: over.channelKind ?? "whatsapp",
    supabaseAdmin: admin.client,
    expectedSubaccountId: over.expectedSubaccountId ?? null,
    instanceId: over.instanceId ?? "inst-1",
    messagingChannelId: over.messagingChannelId ?? null,
    baseUrl: BASE,
    fetchImpl: f.impl,
    encryptionKeyHex: ENC_KEY,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  });
  return { provider, admin, f };
}

// ═════════════════════════════════════════════════════════════════════════════

describe("envelope e rota — o que efetivamente vai no fio", () => {
  it("POSTa na rota do canal, com o envelope e o token da SUBCONTA", async () => {
    const { provider, f } = await makeProvider();
    const r = await provider.sendText({ number: "5511999999999", text: "oi" });

    expect(r.message_id).toBe("wamid.ABC123");
    expect(f.calls).toHaveLength(1);

    const call = f.calls[0];
    expect(call.url).toBe(`${BASE}/v2/channels/whatsapp/messages`);
    expect(call.init.method).toBe("POST");

    const headers = call.init.headers as Record<string, string>;
    // A credencial é a da SUBCONTA daquela org — nunca a da conta-mãe — e viaja
    // em header, nunca na URL nem no corpo.
    expect(headers["X-Api-Token"]).toBe(SUB_TOKEN);
    expect(call.url).not.toContain(SUB_TOKEN);
    expect(String(call.init.body)).not.toContain(SUB_TOKEN);

    const body = JSON.parse(String(call.init.body));
    // `from` é o id do CANAL. Mandar o telefone aqui devolve Hub404 com HTTP 200.
    expect(body.from).toBe(CHANNEL_ID);
    expect(body.to).toBe("5511999999999");
    // `contents` é ARRAY mesmo com um item — achatar devolve erro de shape.
    expect(Array.isArray(body.contents)).toBe(true);
    expect(body.contents).toEqual([{ type: "text", text: "oi" }]);
  });

  it("WhatsApp normaliza o destinatário para dígitos; Instagram vai CRU", async () => {
    const wa = await makeProvider();
    await wa.provider.sendText({ number: "+55 (11) 99999-9999", text: "oi" });
    expect(JSON.parse(String(wa.f.calls[0].init.body)).to).toBe("5511999999999");

    // O IGSID é opaco. Aplicar `\D` a ele funciona hoje por acidente (é
    // numérico) e agruparia a conversa errada no dia em que vier alfanumérico.
    const ig = await makeProvider({ channelKind: "instagram", instanceId: null, messagingChannelId: "mc-1" });
    await ig.provider.sendText({ number: "ig_AbC-123", text: "oi" });
    expect(ig.f.calls[0].url).toBe(`${BASE}/v2/channels/instagram/messages`);
    expect(JSON.parse(String(ig.f.calls[0].init.body)).to).toBe("ig_AbC-123");
  });

  it("as duas rotas são endpoints DISTINTOS, não uma com parâmetro", () => {
    expect(notificameSendPath("whatsapp")).toBe("/v2/channels/whatsapp/messages");
    expect(notificameSendPath("instagram")).toBe("/v2/channels/instagram/messages");
  });
});

describe("veredito pelo CORPO — as duas armadilhas provadas do fornecedor", () => {
  it("Hub404 em HTTP 200 é FALHA, não sucesso", async () => {
    // A armadilha central: `res.ok` é TRUE aqui. Um provider que lesse status
    // gravaria uma mensagem que nunca saiu.
    const { provider, admin } = await makeProvider({}, [[200, HUB404]]);
    await expect(provider.sendText({ number: "5511999999999", text: "oi" })).rejects.toThrow();
    expect(admin.written, "gravou uma linha para um envio que o hub recusou").toHaveLength(0);
  });

  it("AUTHENTICATION_ERROR em HTTP 404 é falha de AUTH, não rota inexistente", async () => {
    const { provider, admin } = await makeProvider({}, [[404, AUTH_ERR]]);
    await expect(provider.sendText({ number: "5511999999999", text: "oi" })).rejects.toThrow();
    expect(admin.written).toHaveLength(0);
  });

  it("texto puro do ServeMux do Go (não-JSON) é falha, não sucesso vazio", async () => {
    const { provider, admin } = await makeProvider({}, [[200, "404 page not found\n"]]);
    await expect(provider.sendText({ number: "5511999999999", text: "oi" })).rejects.toThrow();
    expect(admin.written).toHaveLength(0);
  });

  it("a prosa do fornecedor NÃO atravessa para a mensagem do erro", async () => {
    // `withErrorBoundary` devolve `error.message` cru no corpo do 500; texto de
    // terceiro ali é vazamento.
    const { provider } = await makeProvider({}, [[404, AUTH_ERR]]);
    const err = await provider.sendText({ number: "5511999999999", text: "oi" }).catch((e) => e);
    expect((err as Error).message).not.toContain("invalid token");
    expect((err as { code?: string }).code).toBe("AUTHENTICATION_ERROR");
  });
});

describe("o id é o veredito", () => {
  it("resposta SEM id → erro, e NADA é gravado", async () => {
    const { provider, admin } = await makeProvider({}, [[200, '{"status":"ok"}']]);
    const err = await provider.sendText({ number: "5511999999999", text: "oi" }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("send_no_message_id");
    // Este é o antipadrão recusado: um `external_id` inventado por relógio faria
    // toda reentrega virar linha nova e nenhum status de entrega casar.
    expect(admin.written).toHaveLength(0);
  });

  it("readSentMessageId é tolerante em ALIAS e intolerante em AUSÊNCIA", async () => {
    expect(readSentMessageId({ id: "a1" })).toBe("a1");
    expect(readSentMessageId({ message_id: "b2" })).toBe("b2");
    expect(readSentMessageId({ messageId: "c3" })).toBe("c3");
    expect(readSentMessageId({ data: { messages: [{ id: "d4" }] } })).toBe("d4");
    expect(readSentMessageId({ status: "ok" })).toBeNull();
    expect(readSentMessageId(null)).toBeNull();
    expect(readSentMessageId("wamid.solto")).toBeNull();
  });

  it("sucesso grava em channel_messages com o id REAL e upsert idempotente", async () => {
    const { provider, admin } = await makeProvider();
    await provider.sendText({ number: "5511999999999", text: "oi" });

    expect(admin.written).toHaveLength(1);
    const w = admin.written[0];
    expect(w.table).toBe("channel_messages");
    expect(w.onConflict).toBe("external_id,channel,organization_id");
    expect(w.row.external_id).toBe("wamid.ABC123");
    expect(w.row.organization_id).toBe(ORG);
    expect(w.row.direction).toBe("outgoing");
    expect(w.row.channel).toBe("whatsapp");
    expect(w.row.content).toBe("oi");
  });
});

describe("credencial: por organization_id, com conferência", () => {
  it("subconta que não está pronta → envio para ANTES de qualquer chamada", async () => {
    const { provider, f } = await makeProvider({ subaccount: null });
    const err = await provider.sendText({ number: "5511999999999", text: "oi" }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("subaccount_not_ready");
    expect(f.calls, "gastou uma chamada ao fornecedor sem credencial").toHaveLength(0);
  });

  it("VETOR CROSS-TENANT: subaccount_id da linha discordando do cofre PARA o envio", async () => {
    // `provider_config` é jsonb que qualquer caminho de escrita futuro pode
    // tocar. Se ele ESCOLHESSE o cofre, um valor adulterado mandaria a mensagem
    // pelo canal de OUTRA org. Aqui ele só CONFERE — e a divergência é fatal.
    const { provider, f } = await makeProvider({ expectedSubaccountId: "sub-de-outra-org" });
    const err = await provider.sendText({ number: "5511999999999", text: "oi" }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("subaccount_mismatch");
    expect(f.calls).toHaveLength(0);
  });

  it("CONTROLE POSITIVO: expectedSubaccountId que CONFERE deixa o envio seguir", async () => {
    // Sem isto, os dois casos acima passariam numa implementação que recusasse
    // sempre — e o canal oficial não enviaria nada.
    const { provider, f } = await makeProvider({ expectedSubaccountId: SUB_ROW_ID });
    const r = await provider.sendText({ number: "5511999999999", text: "oi" });
    expect(r.message_id).toBe("wamid.ABC123");
    expect(f.calls).toHaveLength(1);
  });
});

describe("gravação é BEST-EFFORT — a mensagem já saiu", () => {
  it("falha ao gravar NÃO transforma um envio bem-sucedido em erro", async () => {
    // Se virasse erro, o operador reenviaria algo que o cliente já recebeu.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { provider } = await makeProvider({ upsertError: "deadlock detected" });
    const r = await provider.sendText({ number: "5511999999999", text: "oi" });
    expect(r.message_id).toBe("wamid.ABC123");
    expect(r.status).toBe("sent");
    expect(spy, "a perda da linha tem que ser barulhenta no log").toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("guardas de entrada", () => {
  it("texto vazio não gasta chamada", async () => {
    const { provider, f } = await makeProvider();
    await expect(provider.sendText({ number: "5511999999999", text: "   " })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });

  it("destinatário que normaliza para vazio não gasta chamada", async () => {
    const { provider, f } = await makeProvider();
    await expect(provider.sendText({ number: "+()-", text: "oi" })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TEMPLATE — a válvula de escape da janela de 24h.
//
// A regra P5 do send-governor bloqueia texto livre de automação fora da janela
// PORQUE o caminho correto é template. Enquanto `sendTemplate` não existia, a
// regra era beco sem saída. Estes casos travam o fio ligado.
// ═════════════════════════════════════════════════════════════════════════════

describe("sendTemplate", () => {
  it("monta o content de template e POSTa na rota do canal", async () => {
    const { provider, f } = await makeProvider();
    await (provider as unknown as {
      sendTemplate(o: Record<string, unknown>): Promise<{ message_id: string }>;
    }).sendTemplate({
      number: "5511999999999",
      templateName: "reengajamento",
      language: "pt_BR",
      components: [{ type: "body", parameters: [{ type: "text", text: "João" }] }],
    });

    expect(f.calls).toHaveLength(1);
    const body = JSON.parse(String(f.calls[0].init?.body));
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].type).toBe("template");
    expect(body.contents[0].template.name).toBe("reengajamento");
    // O idioma vai como OBJETO {code}, não string — é a assimetria que cala:
    // a listagem devolve string e o envio exige objeto.
    expect(body.contents[0].template.language).toEqual({ code: "pt_BR" });
    expect(body.contents[0].template.components[0].parameters[0].text).toBe("João");
  });

  it("Instagram NÃO tem template — recusa antes de qualquer I/O", async () => {
    const { provider, f } = await makeProvider({
      channelKind: "instagram",
      instanceId: null,
      messagingChannelId: "mc-1",
    });
    await expect(
      (provider as unknown as {
        sendTemplate(o: Record<string, unknown>): Promise<unknown>;
      }).sendTemplate({ number: "1784...", templateName: "x", language: "pt_BR" }),
    ).rejects.toThrow(/does not support/);
    expect(f.calls).toHaveLength(0);
  });

  it("nome ou idioma ausente não gasta chamada", async () => {
    const { provider, f } = await makeProvider();
    const send = (provider as unknown as {
      sendTemplate(o: Record<string, unknown>): Promise<unknown>;
    }).sendTemplate.bind(provider);
    await expect(send({ number: "5511999999999", templateName: " ", language: "pt_BR" })).rejects.toThrow();
    await expect(send({ number: "5511999999999", templateName: "x", language: "  " })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
});

describe("graphComponentsToTemplateComponents", () => {
  it("traduz sub_type (snake, da Graph) para subType e preserva a posição", async () => {
    const { graphComponentsToTemplateComponents: fn } = await import(
      "../../supabase/functions/_shared/whatsapp-providers/notificame-provider"
    );
    const out = fn([{ type: "button", sub_type: "quick_reply", index: 1, parameters: [] }]);
    expect(out[0]).toMatchObject({ type: "button", subType: "quick_reply", index: 1 });
  });

  it("index 0 é POSIÇÃO VÁLIDA — falsy-check recusaria o primeiro botão", async () => {
    const { graphComponentsToTemplateComponents: fn } = await import(
      "../../supabase/functions/_shared/whatsapp-providers/notificame-provider"
    );
    const out = fn([{ type: "button", sub_type: "url", index: 0, parameters: [] }]);
    expect(out[0].index).toBe(0);
  });

  it("parameters vazio é LEGÍTIMO e sobrevive (template sem variável)", async () => {
    const { graphComponentsToTemplateComponents: fn } = await import(
      "../../supabase/functions/_shared/whatsapp-providers/notificame-provider"
    );
    expect(fn([{ type: "body", parameters: [] }])[0].parameters).toEqual([]);
  });

  it("componente de tipo desconhecido falha AQUI, não na Meta", async () => {
    const { graphComponentsToTemplateComponents: fn } = await import(
      "../../supabase/functions/_shared/whatsapp-providers/notificame-provider"
    );
    expect(() => fn([{ type: "rodape_inventado" }])).toThrow();
  });

  it("ausência de components vira lista vazia, não explode", async () => {
    const { graphComponentsToTemplateComponents: fn } = await import(
      "../../supabase/functions/_shared/whatsapp-providers/notificame-provider"
    );
    expect(fn(undefined)).toEqual([]);
  });
});

/**
 * O BALÃO DE DIGITANDO NÃO É UMA MENSAGEM.
 *
 * Ele passa pelo mesmo caminho de envio de todo o resto — e o caminho GRAVA em
 * `channel_messages`. Sem uma exceção explícita, cada tecla digitada pelo
 * vendedor poria uma linha vazia na conversa, e a thread viraria uma escada de
 * nada entre as mensagens de verdade.
 *
 * ⚠️ E ele NUNCA pode derrubar um envio: o Copilot chama `setPresence` antes de
 * toda mensagem. Uma falha de rede no indicador não pode custar a conversa.
 */
describe("digitando", () => {
  it("manda o envelope de typing e NÃO grava linha nenhuma", async () => {
    const { provider, admin, f } = await makeProvider();
    await provider.setPresence("5511999999999", "composing");

    expect(f.calls, "não falou com o fornecedor").toHaveLength(1);
    expect(JSON.parse(String(f.calls[0].init.body)).contents[0]).toEqual({ type: "typing" });
    expect(admin.written, "escreveu uma linha para um indicador").toHaveLength(0);
  });

  it("`available` não gasta chamada — não existe envelope de 'parou de digitar'", async () => {
    const { provider, f } = await makeProvider();
    await provider.setPresence("5511999999999", "available");

    expect(f.calls).toHaveLength(0);
  });

  it("falha no fornecedor NÃO propaga — o Copilot chama isto antes de todo envio", async () => {
    const { provider } = await makeProvider({ fetchImpl: () => Promise.reject(new Error("ECONNRESET")) });

    await expect(provider.setPresence("5511999999999", "composing")).resolves.toBeUndefined();
  });
});
