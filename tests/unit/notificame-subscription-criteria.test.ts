// @vitest-environment node
/**
 * `criteria.channel` é o TOKEN DO CANAL, não a palavra do canal.
 *
 * A doc CORRENTE (app.notificame.com.br/docs/api.md, seção Webhook) mostra
 * `"criteria": { "channel": {{token_do_canal}} }`. A engenharia reversa que
 * originou `registerInboundSubscription` assumiu a palavra ("instagram").
 *
 * As duas leituras são indistinguíveis num corpo que o fornecedor aceite calado:
 * subscription registrada no critério errado assina NADA, e o sintoma é idêntico
 * a "ninguém mandou mensagem ainda". Este arquivo existe para que a volta ao
 * literal fique VERMELHA, e não silenciosa.
 *
 * NADA disto foi exercido contra a conta viva — a revenda está desativada do lado
 * deles. Por isso a função tem escada de fallback, e por isso o teste cobra a
 * ORDEM: primeiro o que a doc diz.
 */
import { describe, it, expect } from "vitest";

const { registerInboundSubscription } = await import(
  "../../supabase/functions/_shared/notificame"
);

const CFG = { baseUrl: "https://api.notificame.com.br", subaccountToken: "TOKEN_SUBCONTA" };
const CHANNEL_ID = "ch_abc123";
const HOOK = "https://torquecrm.com.br/functions/v1/notificame-webhook/s3cr3t/sub-1";

/** fetch fake: responde na ordem dada e grava os corpos enviados. */
function fetchSeq(responses: Array<[number, string]>) {
  const bodies: Array<Record<string, unknown>> = [];
  let i = 0;
  const impl = ((_u: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const [status, body] = responses[Math.min(i++, responses.length - 1)];
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof fetch;
  return { impl, bodies };
}

const OK = '{"code":"SUCCESS"}';
const RECUSA = '{"code":"ERROR","message":"criterio invalido"}';

describe("registerInboundSubscription — criteria.channel", () => {
  it("manda o TOKEN DO CANAL, não a palavra 'instagram'", async () => {
    const f = fetchSeq([[200, OK]]);
    const r = await registerInboundSubscription(
      CFG,
      { webhookUrl: HOOK, channelKind: "instagram", channelId: CHANNEL_ID },
      f.impl,
    );
    expect(r.ok).toBe(true);
    const criteria = f.bodies[0].criteria as Record<string, unknown>;
    expect(criteria.channel).toBe(CHANNEL_ID);
    // CONTROLE: se a palavra voltar, este expect é o que grita.
    expect(criteria.channel).not.toBe("instagram");
  });

  // A doc corrente e o node oficial do n8n (DefinirWebhook.transport.js) mandam
  // APENAS { criteria:{channel}, webhook:{url} }. `eventType` e
  // `criteria.direction` saíram da engenharia reversa do SDK e nenhuma
  // integração conhecida os envia — então eles são FALLBACK, nunca a aposta.
  it("a primeira tentativa é a forma canônica: sem eventType e sem direction", async () => {
    const f = fetchSeq([[200, OK]]);
    await registerInboundSubscription(
      CFG,
      { webhookUrl: HOOK, channelKind: "instagram", channelId: CHANNEL_ID },
      f.impl,
    );
    expect(f.bodies[0]).toEqual({
      criteria: { channel: CHANNEL_ID },
      webhook: { url: HOOK },
    });
    expect(f.bodies[0].eventType).toBeUndefined();
  });

  it("a forma enriquecida só aparece no SEGUNDO degrau", async () => {
    const f = fetchSeq([[200, RECUSA], [200, OK]]);
    await registerInboundSubscription(
      CFG,
      { webhookUrl: HOOK, channelKind: "instagram", channelId: CHANNEL_ID },
      f.impl,
    );
    expect(f.bodies[1].eventType).toBe("MESSAGE");
    expect((f.bodies[1].criteria as Record<string, unknown>).direction).toBe("IN");
  });

  it("recusa de critério desce a escada: canônica, enriquecida, depois a palavra", async () => {
    const f = fetchSeq([[200, RECUSA], [200, RECUSA], [200, OK]]);
    const r = await registerInboundSubscription(
      CFG,
      { webhookUrl: HOOK, channelKind: "instagram", channelId: CHANNEL_ID },
      f.impl,
    );
    expect(r.ok).toBe(true);
    const c = f.bodies.map((b) => b.criteria as Record<string, unknown>);
    expect(c[0]).toEqual({ channel: CHANNEL_ID });
    expect(c[1]).toEqual({ channel: CHANNEL_ID, direction: "IN" });
    expect(c[2]).toEqual({ channel: "instagram" });
  });

  it("sem channelId conhecido, a palavra é o critério — e NÃO é tentada duas vezes", async () => {
    const f = fetchSeq([[200, RECUSA], [200, RECUSA]]);
    await registerInboundSubscription(
      CFG,
      { webhookUrl: HOOK, channelKind: "instagram" },
      f.impl,
    );
    expect(f.bodies).toHaveLength(2);
    expect(f.bodies.every((b) => (b.criteria as Record<string, unknown>).channel === "instagram")).toBe(true);
  });

  it("falha de AUTENTICAÇÃO não desce escada nenhuma — o corpo já disse o problema", async () => {
    const f = fetchSeq([[404, '{"code":"AUTHENTICATION_ERROR"}']]);
    const r = await registerInboundSubscription(
      CFG,
      { webhookUrl: HOOK, channelKind: "instagram", channelId: CHANNEL_ID },
      f.impl,
    );
    expect(r.ok).toBe(false);
    expect(f.bodies).toHaveLength(1);
  });

  it("HTTP 200 com Hub404 no corpo é FALHA e não desce escada (res.ok mentiria)", async () => {
    const f = fetchSeq([[200, '{"error":{"type":"OAuthException","code":"Hub404"}}']]);
    const r = await registerInboundSubscription(
      CFG,
      { webhookUrl: HOOK, channelKind: "instagram", channelId: CHANNEL_ID },
      f.impl,
    );
    expect(r.ok).toBe(false);
    expect(f.bodies).toHaveLength(1);
  });
});

/**
 * O CANAL DEIXA DE SER SÓ INSTAGRAM.
 *
 * `channelKind` era do tipo literal `"instagram"` — não por engano, mas porque só
 * o Instagram assinava. A fatia de recebimento do WhatsApp generalizou o
 * parâmetro, e ele importa num ponto específico: é o DEGRAU DE FALLBACK de
 * `criteria.channel`, usado quando não conhecemos o id do canal.
 *
 * Chumbar "instagram" ali faria o WhatsApp assinar a palavra errada — e assinar a
 * palavra é aceito CALADO pelo fornecedor: responde sucesso, carimbamos `active`,
 * e a subscription não assina canal nenhum. O sintoma é indistinguível de
 * "ninguém mandou mensagem", e foi o que segurou o inbound do Instagram por um
 * dia inteiro (2026-08-17).
 */
describe("registerInboundSubscription — os dois canais", () => {
  it("WhatsApp com id conhecido assina o TOKEN, igual ao Instagram", async () => {
    const f = fetchSeq([[200, OK]]);
    const r = await registerInboundSubscription(
      CFG,
      { webhookUrl: HOOK, channelKind: "whatsapp", channelId: CHANNEL_ID },
      f.impl,
    );
    expect(r.ok).toBe(true);
    expect((f.bodies[0].criteria as Record<string, unknown>).channel).toBe(CHANNEL_ID);
  });

  it("sem id, o fallback usa a palavra DO CANAL — não a do Instagram", async () => {
    const f = fetchSeq([[200, OK]]);
    await registerInboundSubscription(
      CFG,
      { webhookUrl: HOOK, channelKind: "whatsapp" },
      f.impl,
    );
    const criteria = f.bodies[0].criteria as Record<string, unknown>;
    expect(criteria.channel).toBe("whatsapp");
    // CONTROLE: é este expect que pega a regressão de voltar a chumbar.
    expect(criteria.channel).not.toBe("instagram");
  });
});
