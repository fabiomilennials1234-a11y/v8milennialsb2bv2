/**
 * O CALLBACK DE STATUS FECHA A LINHA DO DISPARO (#1724) — pela requisição.
 *
 * O módulo puro (`fechar-entrega.ts`) é provado em
 * `tests/unit/blast-fechar-entrega.test.ts`. Este arquivo prova a JUNÇÃO, que é
 * onde o defeito desta fatia moraria: entre a resolução do callback até a linha
 * de `channel_messages` e o casamento dela com a linha do destinatário.
 *
 * A ARMADILHA QUE ESTE ARQUIVO EXISTE PARA PEGAR
 * ----------------------------------------------
 * O `select` do bloco de status do webhook NÃO trazia `external_id` — e é ele a
 * chave do casamento. Sem a coluna, `linha.external_id` é `undefined`, a busca no
 * Disparo procura por `undefined`, não acha nada, e a entrega NUNCA fecha.
 * Nenhum erro, nenhum log: SILÊNCIO, que é o modo de falha desta fatia inteira.
 *
 * Por isso a asserção aqui é a LINHA DO DESTINATÁRIO gravada, nunca o status 200
 * — o 200 continua igual em todos os caminhos, inclusive nos quebrados.
 *
 * Prior art: `tests/unit/notificame-webhook-handler.test.ts` (captura de
 * `Deno.serve`, deno-mock, supabase-mock).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const SECRET = "s3cr3t-de-teste";
const SUB_ID = "1ff9fbfb-2a3a-4210-aedf-9b80e2095494";
const ORG = "38f3bea4-44c6-4732-bb20-065f547a7ed8";
const OUTRA_ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const CANAL_WA = "d1205fbe-99c7-4744-ac6b-899cfbf03179";

/**
 * O id da RESPOSTA DO ENVIO. UUID, e é o que vive em duas colunas ao mesmo
 * tempo: `channel_messages.external_id` e
 * `blast_plan_recipients.provider_message_id` (`blast-official-runner.ts:288`).
 * É por ele que as duas tabelas se encontram.
 */
const ID_DO_ENVIO = "610d05f8-2efd-4c1a-9f1e-1e0b8d9a7c33";

/**
 * O id ESTÁVEL, base64 longo, que volta nos callbacks. Medido em produção:
 * `provider_message_id = external_id` em ZERO de 747 linhas. Ele NUNCA aparece
 * em `blast_plan_recipients` — está aqui justamente para que o teste falhe se
 * alguém tentar casar por ele.
 */
const ID_ESTAVEL = "dGg3ZzQwYnh3TC9FYVpObVhvbkxQTzJHcXJxaDdabGRrR3J3dDNINjVvdjE4czU0Zg";

const capture = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
}));

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

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, h: unknown) => h,
}));

const state = vi.hoisted(() => ({ mock: null as ReturnType<typeof createMockSupabase> | null }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => state.mock!.sb,
}));

const post = (corpo: unknown) =>
  capture.handler!(
    new Request(`https://x.test/notificame-webhook/${SECRET}/${SUB_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify(corpo),
    }),
  );

const callback = (code: string, extra: Record<string, unknown> = {}) => ({
  type: "MESSAGE_STATUS",
  channel: "whatsapp_business_account",
  messageId: ID_DO_ENVIO,
  messageStatus: { code, providerMessageId: ID_ESTAVEL, ...extra },
  subscriptionId: CANAL_WA,
});

/**
 * A linha do destinatário como o dublê a enxerga.
 *
 * O embed `blast_plans` é uma coisa aninhada de verdade, não uma chave literal:
 * `supabase-mock.ts:112-128` resolve caminho pontilhado descendo pelo objeto, que
 * é a semântica do `!inner` do PostgREST. É isso que torna o guarda de tenant
 * exercitável sem um Postgres.
 */
const destinatario = (
  over: Record<string, unknown> = {},
  org: string = ORG,
) => ({
  id: "dest-1",
  plan_id: "plano-1",
  status: "sent",
  estimated_cost: "0.3217",
  provider_message_id: ID_DO_ENVIO,
  blast_plans: { organization_id: org },
  ...over,
});

beforeEach(async () => {
  vi.resetModules();
  setDenoEnv("NOTIFICAME_WEBHOOK_SECRET", SECRET);
  setDenoEnv("NOTIFICAME_WEBHOOK_IPS", "0.0.0.0/0");
  setDenoEnv("SUPABASE_URL", "https://x.supabase.co");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");

  state.mock = createMockSupabase();
  state.mock.mockTable("notificame_subaccounts", [{ id: SUB_ID, organization_id: ORG }]);
  state.mock.mockTable("channel_messages", [{
    id: "linha-1",
    organization_id: ORG,
    external_id: ID_DO_ENVIO,
    direction: "outgoing",
    status: "sent",
    provider_message_id: null,
    raw_payload: {},
  }]);
  state.mock.mockTable("blast_plan_recipients", [destinatario()]);
  state.mock.mockTable("notificame_webhook_events", []);
  state.mock.mockTable("runtime_logs", []);

  capture.handler = null;
  await import("../../supabase/functions/notificame-webhook/index.ts");
});

describe("entrega — o callback fecha a linha e o custo vira realizado", () => {
  it("marca entregue e copia o custo previsto para realizado", async () => {
    const res = await post(callback("DELIVERED"));
    expect(res.status).toBe(200);

    const fechadas = state.mock!.getUpdated("blast_plan_recipients");
    expect(fechadas).toHaveLength(1);
    expect(fechadas[0]).toMatchObject({
      status: "delivered",
      actual_cost: "0.3217",
    });
    expect(String((fechadas[0] as { delivered_at: string }).delivered_at)).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });

  it("o veredito sai na resposta — é o que torna o casamento observável de fora", async () => {
    const res = await post(callback("DELIVERED"));
    expect(await res.json()).toMatchObject({ status: "updated", blast: "fechada" });
  });

  it("READ fecha como entregue, sem DELIVERED anterior", async () => {
    await post(callback("READ"));
    expect(state.mock!.getUpdated("blast_plan_recipients")[0]).toMatchObject({
      status: "delivered",
    });
  });

  it("recusa marca a linha com o motivo do canal e tira o custo", async () => {
    const res = await post({
      type: "MESSAGE_STATUS",
      messageId: ID_DO_ENVIO,
      messageStatus: {
        code: "ERROR",
        providerMessageId: ID_ESTAVEL,
        error: { code: 131053, details: "Media upload error" },
      },
    });
    expect(res.status).toBe(200);

    expect(state.mock!.getUpdated("blast_plan_recipients")[0]).toMatchObject({
      status: "failed",
      reason: "provider_rejected",
      actual_cost: null,
    });
  });

  it("o casamento é pelo id do ENVIO, nunca pelo id estável do callback", async () => {
    // Se alguém trocar a chave para o `providerMessageId` — que é o que o
    // ADR-0028:23 sugere ao descrever a ordem das chaves invertida —, a busca
    // procura um base64 numa coluna que só tem UUID e não acha NADA, NUNCA.
    state.mock!.mockTable("blast_plan_recipients", [
      destinatario({ provider_message_id: ID_ESTAVEL }),
    ]);

    await post(callback("DELIVERED"));
    expect(state.mock!.getUpdated("blast_plan_recipients")).toHaveLength(0);
  });
});

describe("critério 4 — entrega chega depois do fim do envio", () => {
  it("plano `completed` continua sendo atualizado", async () => {
    // Nada neste caminho lê `blast_plans.status`: o plano só entra como guarda de
    // tenant. Um Disparo encerrado continua recebendo entregas, e é assim que o
    // custo realizado sobe depois que o envio acabou.
    state.mock!.mockTable("blast_plan_recipients", [
      destinatario({ blast_plans: { organization_id: ORG, status: "completed" } }),
    ]);

    await post(callback("DELIVERED"));
    expect(state.mock!.getUpdated("blast_plan_recipients")[0]).toMatchObject({
      status: "delivered",
    });
  });
});

describe("critério 6 — callback que não casa não derruba nada e não inventa linha", () => {
  it("callback de conversa normal passa sem tocar no Disparo", async () => {
    // O caso COMUM. Quase todo MESSAGE_STATUS do produto é de conversa, não de
    // Disparo — não pode logar por evento, não pode inserir, não pode falhar.
    state.mock!.mockTable("blast_plan_recipients", []);

    const res = await post(callback("DELIVERED"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ blast: "sem_linha" });

    expect(state.mock!.getUpdated("blast_plan_recipients")).toHaveLength(0);
    expect(state.mock!.getInserted("blast_plan_recipients")).toHaveLength(0);
    // E o que o webhook já fazia continua feito.
    expect(state.mock!.getUpdated("channel_messages")).toHaveLength(1);
  });

  it("callback de OUTRA org não fecha a linha desta", async () => {
    // `blast_plan_recipients` não tem organization_id e a UNIQUE de
    // provider_message_id é GLOBAL (#1721). Sem o guarda de tenant no join, um
    // id repetido entre organizações fecharia a linha errada.
    state.mock!.mockTable("blast_plan_recipients", [destinatario({}, OUTRA_ORG)]);

    await post(callback("DELIVERED"));
    expect(state.mock!.getUpdated("blast_plan_recipients")).toHaveLength(0);
  });

  it("falha ao fechar o Disparo não desfaz o update da mensagem nem muda o 200", async () => {
    state.mock!.mockSelectError("blast_plan_recipients", {
      code: "57014", message: "statement timeout",
    });
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(callback("DELIVERED"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ blast: "erro" });
    expect(state.mock!.getUpdated("channel_messages")).toHaveLength(1);
    console_.mockRestore();
  });
});

/**
 * A GUARDA ESTÁTICA — e por que ela não pôde ser um teste de comportamento.
 *
 * `external_id` é a chave que sai de `channel_messages` para a linha do Disparo.
 * Tirá-la do `select` não quebra nada visível: a entrega simplesmente nunca
 * fecha, em silêncio.
 *
 * Tentei provar isso pelo comportamento e NÃO DÁ: o dublê de PostgREST descarta
 * a lista de campos (`tests/helpers/supabase-mock.ts:236` — `select: (_fields?:
 * string, …)`) e devolve a linha inteira de qualquer jeito. Removi a coluna do
 * código e os nove testes de comportamento seguiram VERDES. Um teste que não
 * distingue não é teste, então a amarra aqui é o TEXTO do arquivo — o mesmo
 * padrão de `tests/unit/blast-recipient-status-vocabulary.test.ts`.
 */
describe("o select do bloco de status carrega a chave do casamento", () => {
  const WEBHOOK = resolve(
    __dirname,
    "../../supabase/functions/notificame-webhook/index.ts",
  );

  it("`colunas` inclui external_id", () => {
    const fonte = readFileSync(WEBHOOK, "utf8");
    const colunas = fonte.match(/const colunas = "([^"]+)";/);

    expect(colunas, "a declaração de `colunas` sumiu ou mudou de forma").not.toBeNull();
    expect(
      colunas![1].split(",").map((c) => c.trim()),
      "sem `external_id` a linha do Disparo nunca é encontrada, e o modo de " +
        "falha é SILÊNCIO — nenhum erro, nenhum log, a entrega só não fecha.",
    ).toContain("external_id");
  });

  it("o fechamento do Disparo é alimentado por `linha.external_id`, não pelo id do evento", () => {
    // O id do EVENTO (`st.messageId`) não é estável por mensagem, e o
    // `providerMessageId` vive noutro espaço de identificador. Só `external_id`
    // casa com o que o worker gravou.
    const fonte = readFileSync(WEBHOOK, "utf8");
    expect(fonte).toContain("externalId: linha.external_id,");
  });
});
