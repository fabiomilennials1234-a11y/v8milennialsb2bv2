/**
 * HARNESS DO HANDLER DO WEBHOOK — a rede que faltava.
 *
 * `notificame-webhook` tem mais de 200 linhas resolvendo DE QUEM é a mensagem:
 * quatro ramos, dois desvios para a fila, e uma comparação de organização que é a
 * única barreira contra forja. Até aqui, ZERO testes — porque exercitá-lo exigia
 * Deno e Supabase.
 *
 * Foi por essa fresta que três defeitos chegaram a produção em 18/08. O mais caro
 * deles é o caso 1 abaixo: um `if/else` mal fechado que sobrevivia a 292 testes
 * verdes e só apareceu ao reinjetar o payload real, quatro deploys depois.
 *
 * O seam é a REQUISIÇÃO HTTP, não as funções por dentro. Testar por dentro deixa
 * os buracos ENTRE as funções — e era exatamente entre duas que o defeito morava.
 *
 * Prior art: `tests/unit/lead-webhook.test.ts` (captura do handler, deno-mock,
 * supabase-mock). Aqui a captura é de `Deno.serve` e não de `serve()`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";
import { buildOutboundChannelMessageRow } from "../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts";

const SECRET = "s3cr3t-de-teste";
const SUB_ID = "1ff9fbfb-2a3a-4210-aedf-9b80e2095494";
const ORG = "38f3bea4-44c6-4732-bb20-065f547a7ed8";
const CANAL_WA = "d1205fbe-99c7-4744-ac6b-899cfbf03179";
const INSTANCIA = "7312692e-b9b4-4f90-aba3-09cff992bbfc";

const capture = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
}));

// `Deno.serve` registra o handler; guardamos a referência para chamá-lo direto.
//
// ⚠️ O `env` é montado AQUI, e não deixado para o `deno-mock`: `vi.hoisted` roda
// ANTES dos imports, então o mock veria `globalThis.Deno` já definido e pularia a
// criação do `env` inteiro — o handler morreria em `Deno.env.get` na primeira
// linha. Definir os dois juntos é o que mantém o import do deno-mock inofensivo.
vi.hoisted(() => {
  const g = globalThis as unknown as { Deno?: Record<string, unknown> };
  const store: Record<string, string> = {};
  g.Deno = {
    ...(g.Deno ?? {}),
    env: {
      get: (k: string) => store[k],
      set: (k: string, v: string) => { store[k] = v; },
      delete: (k: string) => { delete store[k]; },
      toObject: () => ({ ...store }),
    },
    serve: (h: unknown) => { capture.handler = h as never; },
  };
});

// O boundary vira passthrough: queremos o erro CRU do handler, não o 500 dele.
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, h: unknown) => h,
}));

const state = vi.hoisted(() => ({ mock: null as ReturnType<typeof createMockSupabase> | null }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => state.mock!.sb,
}));

/** O corpo REAL que o fornecedor entregou em 18/08, reduzido ao essencial. */
const payloadWhatsApp = () => ({
  id: "f1a73670-36cf-47a8-98de-62f49df0795d",
  type: "MESSAGE",
  channel: "whatsapp_business_account",
  direction: "IN",
  timestamp: "2026-08-18 07:03:28 pm",
  message: {
    id: "f1a73670-36cf-47a8-98de-62f49df0795d",
    to: CANAL_WA,
    from: "554884334050",
    channel: "whatsapp_business_account",
    visitor: { name: "Gabriel Gipp", firstName: "", lastName: "" },
    contents: [{ type: "text", text: "Olá, testando a conexão" }],
    direction: "IN",
  },
});

const post = (corpo: unknown) =>
  capture.handler!(
    new Request(`https://x.test/notificame-webhook/${SECRET}/${SUB_ID}`, {
      method: "POST",
      // O IP de origem vem de `x-forwarded-for`, e a allowlist o compara. Sem o
      // header o handler devolve 403 e, de novo, não chega a resolver canal.
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify(corpo),
    }),
  );

beforeEach(async () => {
  vi.resetModules();
  setDenoEnv("NOTIFICAME_WEBHOOK_SECRET", SECRET);
  // Sem isto o handler para em `503 ip_allowlist_unset` ANTES de resolver canal —
  // e o teste passa por não chegar lá. Foi o primeiro veredito deste harness, e
  // só apareceu porque o controle negativo (rodar com o bug de volta) continuou
  // verde. Asserção que não distingue não é teste.
  setDenoEnv("NOTIFICAME_WEBHOOK_IPS", "0.0.0.0/0");
  setDenoEnv("SUPABASE_URL", "https://x.supabase.co");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
  // A segunda busca de um status sem linha espera 2s em produção; aqui, não.
  setDenoEnv("NOTIFICAME_STATUS_RETRY_MS", "0");

  state.mock = createMockSupabase();
  state.mock.mockTable("notificame_subaccounts", [{ id: SUB_ID, organization_id: ORG }]);
  // A org NÃO tem canal social — é o que empurra a resolução para a outra tabela.
  state.mock.mockTable("messaging_channels", []);
  // ⚠️ A chave é o caminho jsonb LITERAL: o dublê compara `row[campo]` com o
  // valor, e o código filtra por `provider_config->>channel_id`. Representar
  // assim é o que torna o ramo alcançável sem um Postgres de verdade.
  state.mock.mockTable("whatsapp_instances", [{
    id: INSTANCIA,
    organization_id: ORG,
    provider: "notificame",
    "provider_config->>channel_id": CANAL_WA,
    provider_config: { channel_id: CANAL_WA, channel_type: "whatsapp_business_account" },
  }]);
  state.mock.mockTable("channel_messages", []);
  state.mock.mockTable("notificame_webhook_events", []);
  state.mock.mockTable("lead_social_identities", []);
  state.mock.mockTable("runtime_logs", []);

  capture.handler = null;
  await import("../../supabase/functions/notificame-webhook/index.ts");
});

describe("resolução de canal — o ramo do WhatsApp oficial", () => {
  it("NÃO devolve 500 quando o canal só existe em whatsapp_instances", async () => {
    // A REGRESSÃO DE 18/08. O código anterior encontrava a instância e a linha
    // seguinte a sobrescrevia com `readChannelRow(null)` — `Cannot read
    // properties of null (reading 'id')`, HTTP 500, evento PERDIDO (nem chega à
    // fila de inspeção). Este expect é o que fica vermelho contra aquele código.
    const res = await post(payloadWhatsApp());
    expect(res.status).toBe(200);

    // A ASSERÇÃO É A LINHA GRAVADA, não o status. `not.toBe(500)` passava igual
    // quando o evento era PARKADO — e passou, com o bug de volta, na primeira
    // versão deste teste.
    const gravadas = state.mock!.getInserted("channel_messages");
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]).toMatchObject({
      channel: "whatsapp",
      direction: "incoming",
      instance_id: INSTANCIA,
      messaging_channel_id: null,
      content: "Olá, testando a conexão",
    });
  });

  it("grava a chave CANÔNICA do contato — o wa_id sem o nono dígito não abre outra conversa", async () => {
    // O defeito de 20/10: o envio grava 5548984334050 (telefone do lead) e a
    // Meta entrega a resposta como 554884334050. A caixa agrupa por
    // contact_external_id; sem a chave canônica, duas conversas.
    const res = await post(payloadWhatsApp());
    expect(res.status).toBe(200);

    const [linha] = state.mock!.getInserted("channel_messages");
    expect(linha).toMatchObject({
      contact_external_id: "5548984334050",
      phone_number: "5548984334050",
      // Quem mandou continua registrado como a Meta mandou.
      sender_id: "554884334050",
    });
  });
});

/**
 * O CALLBACK DE STATUS — o silêncio que fez o áudio parecer entregue.
 *
 * Em 19/08 a Meta recusou um áudio da Chique com `131053`. O callback chegou 2s
 * depois do envio e foi PARKADO como `unresolved_channel`: a resolução procura em
 * `messaging_channels`, e a caixa oficial mora em `whatsapp_instances`. A linha
 * ficou `status='sent'` para sempre, e a tela disse "enviado".
 *
 * Estes testes exercitam o handler pela REQUISIÇÃO, que é onde o defeito morava —
 * entre a resolução de canal e o despacho por tipo de evento, não dentro de
 * nenhuma das duas.
 */
const ID_MENSAGEM = "d7370d65-7893-4989-9f09-d82fa86fa542";

/** O corpo REAL da recusa (evento `60390bfa` em produção), reduzido. */
const payloadRecusa = () => ({
  type: "MESSAGE_STATUS",
  channel: "whatsapp_business_account",
  messageId: ID_MENSAGEM,
  messageStatus: {
    code: "ERROR",
    error: {
      code: 131053,
      details:
        "Audio file uploaded with mimetype as audio/mp4, however on processing it is of type application/octet-stream.",
      message: "Media upload error",
    },
  },
  subscriptionId: CANAL_WA,
});

describe("MESSAGE_STATUS — a recusa da Meta chega até a linha", () => {
  beforeEach(() => {
    state.mock!.mockTable("channel_messages", [{
      id: "linha-1",
      organization_id: ORG,
      external_id: ID_MENSAGEM,
      direction: "outgoing",
      status: "sent",
      provider_message_id: null,
      raw_payload: { request: { to: "554884334050" }, response: { id: ID_MENSAGEM } },
    }]);
  });

  it("marca a mensagem como `failed` e guarda o motivo da Meta", async () => {
    const res = await post(payloadRecusa());
    expect(res.status).toBe(200);

    const atualizadas = state.mock!.getUpdated("channel_messages");
    expect(atualizadas).toHaveLength(1);
    expect(atualizadas[0]).toMatchObject({ status: "failed" });

    const evento = (atualizadas[0] as { raw_payload: Record<string, unknown> })
      .raw_payload.status_event as Record<string, unknown>;
    expect(evento).toMatchObject({ code: "failed", provider_code: "131053" });
    expect(String(evento.detail)).toContain("application/octet-stream");
  });

  it("PRESERVA a requisição e a resposta do envio no mesmo campo", async () => {
    // O PostgREST substitui a coluna jsonb inteira. Escrever só o status_event
    // apagaria a evidência que fez este bloco existir.
    await post(payloadRecusa());

    const raw = (state.mock!.getUpdated("channel_messages")[0] as {
      raw_payload: Record<string, unknown>;
    }).raw_payload;

    expect(raw.request).toMatchObject({ to: "554884334050" });
    expect(raw.response).toMatchObject({ id: ID_MENSAGEM });
  });

  it("NÃO rebaixa o STATUS, mas registra o evento (é onde mora a chave de correlação)", async () => {
    state.mock!.mockTable("channel_messages", [{
      id: "linha-1",
      organization_id: ORG,
      external_id: ID_MENSAGEM,
      direction: "outgoing",
      status: "read",
      raw_payload: {},
    }]);

    const res = await post({
      type: "MESSAGE_STATUS",
      messageId: ID_MENSAGEM,
      messageStatus: { code: "DELIVERED" },
    });

    expect(res.status).toBe(200);

    // A linha É tocada — mas o `status` NÃO retrocede. Sair sem escrever foi o
    // defeito da primeira versão: o `provider_message_id` mora no `status_event`,
    // e sem gravá-lo a RECUSA seguinte não acha a linha.
    const atualizadas = state.mock!.getUpdated("channel_messages");
    expect(atualizadas).toHaveLength(1);
    // Continua `read`: o DELIVERED atrasado NÃO retrocedeu o status.
    expect(atualizadas[0]).toMatchObject({ status: "read" });
    expect(
      (atualizadas[0] as { raw_payload: Record<string, unknown> })
        .raw_payload.status_event,
    ).toMatchObject({ code: "delivered" });
  });

  it("mas uma RECUSA depois de entregue vale — foi a ordem que a Meta produziu", async () => {
    state.mock!.mockTable("channel_messages", [{
      id: "linha-1",
      organization_id: ORG,
      external_id: ID_MENSAGEM,
      direction: "outgoing",
      status: "delivered",
      raw_payload: {},
    }]);

    await post(payloadRecusa());
    expect(state.mock!.getUpdated("channel_messages")[0]).toMatchObject({ status: "failed" });
  });


  /**
   * O DEFEITO DE 13:41 — e o motivo de existir uma segunda chave.
   *
   * Medido em produção: o `SENT` chegou com o id que está em `external_id`, e o
   * `ERROR` da MESMA mensagem, 376ms depois, veio com um `messageId` DIFERENTE.
   * O que os liga é o `providerMessageId`, idêntico nos dois. A primeira versão
   * deste bloco casava só pelo `messageId` — e a recusa caiu em
   * `status_no_match`, com o áudio seguindo "enviado" na tela.
   */
  it("a recusa chega com OUTRO messageId e ainda assim acha a linha", async () => {
    const PROVIDER_ID = "U2hTM01ZaXNNL0VhWk5tWG9uTFBPMkdxcnFoN1psZGtHcnd0M0g2NW92MThzNTRm";

    // 1º callback: SENT, com o id que casa por `external_id`. É ele que grava a
    // chave de correlação na linha.
    await post({
      type: "MESSAGE_STATUS",
      messageId: ID_MENSAGEM,
      messageStatus: { code: "SENT", providerMessageId: PROVIDER_ID },
    });

    const depoisDoSent = state.mock!.getUpdated("channel_messages");
    expect(depoisDoSent).toHaveLength(1);
    // A chave vai para COLUNA, não para dentro do jsonb: é por ela que o
    // callback seguinte procura, e busca dentro de `raw_payload` custaria um
    // índice de expressão para o mesmo fim.
    expect(depoisDoSent[0]).toMatchObject({ provider_message_id: PROVIDER_ID });

    // 2º callback: a RECUSA, com messageId que não existe em lugar nenhum.
    const res = await post({
      type: "MESSAGE_STATUS",
      messageId: "403807e5-e6d6-439a-afe1-7bedf4fd4e50",
      messageStatus: {
        code: "ERROR",
        providerMessageId: PROVIDER_ID,
        error: { code: 131053, details: "Media upload error" },
      },
    });

    expect(res.status).toBe(200);
    const atualizadas = state.mock!.getUpdated("channel_messages");
    expect(atualizadas[atualizadas.length - 1]).toMatchObject({ status: "failed" });
  });

  /**
   * A RECUSA QUE CHEGA ANTES DA CHAVE — 30/09, Chique.
   *
   * O `ERROR 131047` chegou 1,7s ANTES do `SENT` que grava o
   * `provider_message_id`. Parkado como `status_no_match`, e a mensagem seguiu
   * "enviada" na tela. Quando o `SENT` grava a chave, o que estava parkado com o
   * mesmo id tem que cair na linha.
   */
  it("o SENT que grava a chave reaplica a recusa parkada antes dele", async () => {
    const PROVIDER_ID = "QlFES2Zka2d4L1JkMXdqb3poczVJeVRITFJtT0VOc3FZTjIw";
    const recusaParkada = {
      type: "MESSAGE_STATUS",
      messageId: "7d312141-6062-4832-83d2-339c95cce47d",
      messageStatus: {
        code: "ERROR",
        providerMessageId: PROVIDER_ID,
        error: {
          code: 131047,
          details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
          message: "Re-engagement message",
        },
      },
    };
    state.mock!.mockTable("notificame_webhook_events", [{
      id: "parkado-1",
      organization_id: ORG,
      status: "parked",
      reason: "status_no_match",
      received_at: "2026-09-30T13:21:38.949Z",
      payload: recusaParkada,
      // O dublê compara a chave LITERAL — o código filtra pelo caminho jsonb.
      "payload->messageStatus->>providerMessageId": PROVIDER_ID,
    }]);

    const res = await post({
      type: "MESSAGE_STATUS",
      messageId: ID_MENSAGEM,
      messageStatus: { code: "SENT", providerMessageId: PROVIDER_ID },
    });
    expect(res.status).toBe(200);

    const atualizadas = state.mock!.getUpdated("channel_messages");
    const final = atualizadas[atualizadas.length - 1] as Record<string, unknown>;
    expect(final).toMatchObject({ status: "failed", provider_message_id: PROVIDER_ID });
    expect((final.raw_payload as Record<string, Record<string, unknown>>).status_event)
      .toMatchObject({ provider_code: "131047" });

    // E o parkado sai da fila — senão a próxima inspeção o conta como perdido.
    expect(state.mock!.getUpdated("notificame_webhook_events")[0])
      .toMatchObject({ id: "parkado-1", status: "processed" });
  });

  it("parkado de OUTRA mensagem não é tocado", async () => {
    state.mock!.mockTable("notificame_webhook_events", [{
      id: "parkado-alheio",
      organization_id: ORG,
      status: "parked",
      reason: "status_no_match",
      payload: { type: "MESSAGE_STATUS", messageId: "x", messageStatus: { code: "ERROR", providerMessageId: "OUTRO" } },
      "payload->messageStatus->>providerMessageId": "OUTRO",
    }]);

    await post({
      type: "MESSAGE_STATUS",
      messageId: ID_MENSAGEM,
      messageStatus: { code: "SENT", providerMessageId: "ESTE" },
    });

    expect(state.mock!.getUpdated("channel_messages")[0]).toMatchObject({ status: "sent" });
    expect(state.mock!.getUpdated("notificame_webhook_events")).toHaveLength(0);
  });

  it("status de mensagem que não é desta org é GUARDADO, nunca aplicado", async () => {
    state.mock!.mockTable("channel_messages", []);

    const res = await post(payloadRecusa());

    expect(res.status).toBe(200);
    expect(state.mock!.getUpdated("channel_messages")).toHaveLength(0);
    expect(state.mock!.getInserted("notificame_webhook_events")).toHaveLength(1);
  });
});

/**
 * A PERNA DE VOLTA — issue #1686.
 *
 * O segundo nó mais executado do produto é o "esperar resposta": 11.653
 * execuções em 7 dias. Ele destrava porque o webhook do chip chama uma RPC
 * quando chega mensagem do cliente. Este webhook não chamava nada, e uma
 * execução que esperasse resposta no canal oficial esperava para sempre.
 *
 * O efeito observável É a chamada: destravar uma execução não deixa rastro em
 * nenhuma tabela que este dublê veja.
 */
describe("perna de volta", () => {
  it("resposta do cliente no canal oficial destrava a espera, por telefone", async () => {
    const res = await post(payloadWhatsApp());
    expect(res.status).toBe(200);

    const chamada = state.mock!.getRpcCalls()
      .find((c) => c.name === "resolve_wait_response_by_phone");

    expect(chamada, "o workflow nunca soube que o cliente respondeu").toBeDefined();
    // A forma CANÔNICA (com o nono dígito), não o wa_id cru de 12 dígitos: é a
    // mesma chave da conversa, e a forma em que o lead está cadastrado.
    expect((chamada!.params as { p_phone?: string }).p_phone).toBe("5548984334050");
    expect((chamada!.params as { p_organization_id?: string }).p_organization_id).toBe(ORG);
  });

  it("uma falha ao destravar NÃO derruba a gravação nem o 200", async () => {
    // O contrato do webhook é devolver 200 e guardar o corpo. Uma reação que
    // falha não pode custar a mensagem — o fornecedor desiste depois das
    // tentativas dele e o dado morre sem uma linha em lugar nenhum.
    state.mock!.mockRpc("resolve_wait_response_by_phone", undefined);

    const res = await post(payloadWhatsApp());
    expect(res.status).toBe(200);
  });
});

  /**
   * ⚠️ O GATILHO "lead respondeu" NÃO é asserido aqui, e é decisão, não desistência.
   *
   * Prová-lo neste seam exigiria encenar três camadas alheias: um lead cujo
   * telefone normalize exatamente como o serviço de lead normaliza, um workflow
   * ativo com aquele gatilho, e uma configuração que case. Estaria testando o
   * disparador de gatilhos e o serviço de lead — ambos com testes próprios — e
   * quebraria quando qualquer um deles mudasse de forma interna.
   *
   * O que ESTE seam prova é o que só ele pode provar: que a entrada aciona, que
   * a saída não aciona, e que ninguém é criado. A decisão de disparar mora na
   * regra pura (`notificame-reacoes.test.ts`), onde é exercitada sem banco.
   */
  it("sem lead com aquele telefone, o gatilho NÃO dispara — e não cria ninguém", async () => {
    // ⚠️ Resolve-only, nunca criar. Um lead nascido de cada mensagem recebida
    // encheria a base com quem só perguntou preço, e no eixo social o
    // identificador da plataforma entraria como se fosse telefone.
    state.mock!.mockTable("leads", []);

    const res = await post(payloadWhatsApp());
    expect(res.status).toBe(200);
    expect(state.mock!.getInserted("leads")).toHaveLength(0);
  });

/**
 * A PERNA DE VOLTA NO INSTAGRAM — issue #1692.
 *
 * Mesma perna, OUTRA CHAVE. Lá não existe telefone: o interlocutor é um
 * identificador da plataforma, e quem destrava é a variante da RPC que recebe o
 * LEAD direto. Ela só tem o que receber quando um humano já vinculou a conversa
 * pelo botão que existe no chat.
 *
 * ⚠️ MEDIDO: 562 mensagens de Instagram recebidas em produção, ZERO com lead
 * vinculado. Enquanto ninguém vincular, este caminho fica OCIOSO — e isso é o
 * estado esperado, não defeito. É por isso que o caso do meio existe: ele fixa
 * que a ausência de vínculo não aciona nada e não vira erro.
 *
 * O efeito observável É a chamada: destravar uma execução não deixa rastro em
 * nenhuma tabela que este dublê veja.
 */
describe("perna de volta — Instagram", () => {
  const CANAL_IG = "ig-channel-0001";
  const IGSID = "igsid-cliente-777";
  const LEAD = "11111111-2222-3333-4444-555555555555";

  /** O corpo no formato que a doc do fornecedor sugere — nenhum evento real de
   *  Instagram foi observado, então esta é a hipótese corrente, a mesma que
   *  `notificame-webhook-inbound.test.ts` usa. */
  const payloadInstagram = (over: Record<string, unknown> = {}) => ({
    eventType: "MESSAGE",
    direction: "IN",
    channelId: CANAL_IG,
    id: "mid-ig-001",
    from: { id: IGSID, name: "Fulana", username: "@fulana" },
    contents: [{ type: "text", text: "oi, tem em estoque?" }],
    timestamp: "2026-08-20T18:04:00.000Z",
    ...over,
  });

  const semearCanal = () => {
    state.mock!.mockTable("messaging_channels", [{
      id: "0f6a1f7e-2c11-4c2f-9a4a-8b7f6a1c3d21",
      organization_id: ORG,
      provider: "notificame",
      channel_type: "instagram",
      external_channel_id: CANAL_IG,
      status: "connected",
      handle: null,
    }]);
  };

  const vincular = () => {
    state.mock!.mockTable("lead_social_identities", [{
      id: "aaaa1111-bbbb-2222-cccc-333344445555",
      organization_id: ORG,
      lead_id: LEAD,
      channel_type: "instagram",
      external_user_id: IGSID,
    }]);
  };

  it("resposta em conversa VINCULADA destrava a espera, PELO LEAD", async () => {
    semearCanal();
    vincular();

    const res = await post(payloadInstagram());
    expect(res.status).toBe(200);

    const chamada = state.mock!.getRpcCalls()
      .find((c) => c.name === "resolve_wait_response");

    expect(chamada, "o workflow nunca soube que o cliente respondeu no Direct").toBeDefined();
    expect((chamada!.params as { p_lead_id?: string }).p_lead_id).toBe(LEAD);
    expect((chamada!.params as { p_organization_id?: string }).p_organization_id).toBe(ORG);
  });

  it("conversa SEM lead vinculado não aciona NADA — e isso não é erro", async () => {
    // O estado das 562 mensagens medidas em produção. O vínculo é manual e é
    // pré-requisito; sem ele não há por qual chave resolver. A mensagem entra
    // normalmente — o que não pode acontecer é o workflow ser acionado por uma
    // conversa que ninguém disse a quem pertence.
    semearCanal();
    state.mock!.mockTable("lead_social_identities", []);

    const res = await post(payloadInstagram());
    expect(res.status).toBe(200);

    const chamadas = state.mock!.getRpcCalls().map((c) => c.name);
    expect(chamadas).not.toContain("resolve_wait_response");
    // ⚠️ E MUITO MENOS pela chave de telefone: o identificador do Instagram tem
    // 15 a 17 dígitos e `normalize_brazilian_phone` o devolve intacto — ele
    // casaria com `leads.normalized_phone` e viraria alvo de disparo.
    expect(chamadas).not.toContain("resolve_wait_response_by_phone");
  });

  it("mensagem de SAÍDA não aciona nada, mesmo em conversa vinculada", async () => {
    // O que o vendedor responde pelo aplicativo do fornecedor entra como
    // `outgoing`. Tratá-la como resposta do cliente destravaria o workflow com
    // a NOSSA própria mensagem, e o prazo de espera se renovaria sozinho.
    semearCanal();
    vincular();

    const res = await post(payloadInstagram({
      direction: "OUT",
      to: { id: IGSID },
      from: { id: CANAL_IG },
    }));
    expect(res.status).toBe(200);

    expect(state.mock!.getRpcCalls().map((c) => c.name))
      .not.toContain("resolve_wait_response");
  });

  it("uma falha ao destravar NÃO derruba a gravação nem o 200", async () => {
    semearCanal();
    vincular();
    state.mock!.mockRpc("resolve_wait_response", undefined);

    const res = await post(payloadInstagram());
    expect(res.status).toBe(200);
  });
});

/**
 * A CONVERSA PARTIDA PELO NONO DÍGITO — de ponta a ponta.
 *
 * O caso medido em prod em 2026-10-20: o CRM envia um template para o telefone
 * do lead, com o nono dígito; o cliente clica no botão e a Meta entrega a
 * resposta com o `wa_id` SEM ele. A caixa agrupa por
 * `(instance_id, contact_external_id)` e a mesma pessoa virava duas conversas.
 *
 * O envio é montado pelo builder REAL do provider; a resposta entra pela
 * REQUISIÇÃO, no formato real de clique de botão (`from` de 12 dígitos +
 * `context` citando o template). Números fictícios.
 */
describe("envio com 13 dígitos + resposta com 12 → UMA conversa", () => {
  const COM_9 = "5591999990000";
  const SEM_9 = "559199990000";

  const respostaDeBotao = () => ({
    id: "e2e-resposta-botao-0001",
    type: "MESSAGE",
    channel: "whatsapp_business_account",
    message: {
      id: "e2e-resposta-botao-0001",
      to: CANAL_WA,
      from: SEM_9,
      channel: "whatsapp_business_account",
      context: { id: "wamid.template-enviado-0001", from: "5511900000000" },
      visitor: { name: "Cliente Fictício", picture: "", lastName: "", firstName: "" },
      contents: [{ type: "button", button: { text: "Sim", payload: "Sim" } }],
      direction: "IN",
      timestamp: "2026-10-20 04:21:00 pm",
    },
    direction: "IN",
    timestamp: "2026-10-20 04:21:00 pm",
    subscriptionId: CANAL_WA,
    providerMessageId: "wamid.resposta-0001",
  });

  it("as duas linhas caem no mesmo grupo (instance_id, contact_external_id)", async () => {
    const enviada = buildOutboundChannelMessageRow({
      organizationId: ORG,
      channelKind: "whatsapp",
      instanceId: INSTANCIA,
      messagingChannelId: null,
      contactExternalId: COM_9,
      externalId: "wamid.template-enviado-0001",
      messageType: "template",
      content: "Olá! Podemos falar?",
      mediaUrl: null,
      timestampIso: "2026-10-20T16:17:00.000Z",
      rawPayload: {},
    });

    const res = await post(respostaDeBotao());
    expect(res.status).toBe(200);

    const recebidas = state.mock!.getInserted("channel_messages");
    expect(recebidas).toHaveLength(1);
    const recebida = recebidas[0] as Record<string, unknown>;

    // A chave é a mesma nos dois sentidos…
    expect(enviada.contact_external_id).toBe(COM_9);
    expect(recebida.contact_external_id).toBe(COM_9);
    expect(recebida.phone_number).toBe(COM_9);
    // …e quem mandou continua registrado como a Meta mandou.
    expect(recebida.sender_id).toBe(SEM_9);

    // O agrupamento da lista da caixa: DISTINCT ON (instance_id, contact_external_id).
    const grupos = new Set(
      [enviada, recebida].map((r) =>
        `${(r as Record<string, unknown>).instance_id}|${(r as Record<string, unknown>).contact_external_id}`
      ),
    );
    expect(grupos.size, "a mesma pessoa virou duas conversas").toBe(1);
  });
});
