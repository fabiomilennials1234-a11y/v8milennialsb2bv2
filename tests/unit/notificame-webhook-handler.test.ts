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

  it("NÃO rebaixa: DELIVERED atrasado não apaga um READ que já chegou", async () => {
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
    expect(state.mock!.getUpdated("channel_messages")).toHaveLength(0);
    // Guardado, não descartado: o corpo é a única evidência que sobra.
    expect(state.mock!.getInserted("notificame_webhook_events")).toHaveLength(1);
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

  it("status de mensagem que não é desta org é GUARDADO, nunca aplicado", async () => {
    state.mock!.mockTable("channel_messages", []);

    const res = await post(payloadRecusa());

    expect(res.status).toBe(200);
    expect(state.mock!.getUpdated("channel_messages")).toHaveLength(0);
    expect(state.mock!.getInserted("notificame_webhook_events")).toHaveLength(1);
  });
});
