import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { OracleActor } from "./scope.ts";
import { type FeedbackDeps, handleFeedback } from "./feedback-handler.ts";

const MEMBER: OracleActor = {
  userId: "10000000-0000-4000-8000-000000000001",
  teamMemberId: "20000000-0000-4000-8000-000000000001",
  organizationId: "30000000-0000-4000-8000-000000000001",
  role: "member",
  isMaster: false,
  isAdmin: false,
};
const MASTER = { ...MEMBER, isMaster: true, isAdmin: true };
const FEEDBACK_ID = "70000000-0000-4000-8000-000000000001";
const ALERT_ID = "80000000-0000-4000-8000-000000000001";

function request(body: Record<string, unknown>) {
  return new Request("http://local/oraculo-feedback", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function setup(actor = MEMBER) {
  const calls: Array<{ name: string; value: unknown }> = [];
  const deps: FeedbackDeps = {
    auth: () => Promise.resolve(actor),
    submit: (_actor, input) => {
      calls.push({ name: "submit", value: input });
      return Promise.resolve({
        id: FEEDBACK_ID,
        alertId: input.reason === "invented" ? ALERT_ID : null,
      });
    },
    notifyNow: (alertId) => {
      calls.push({ name: "notify", value: alertId });
      return Promise.resolve(false);
    },
    state: () => Promise.resolve({ conversation: null, responses: {} }),
    signal: (_actor, input) => {
      calls.push({ name: "signal", value: input });
      return Promise.resolve();
    },
    listCases: () => Promise.resolve([{ id: FEEDBACK_ID }]),
    getCase: (_actor, id) => Promise.resolve({ id, trace: [{ name: "metricas" }] }),
  };
  return { deps, calls };
}

Deno.test("feedback — avaliação positiva por resposta usa alvo derivado no servidor", async () => {
  const { deps, calls } = setup();
  const response = await handleFeedback(
    request({
      acao: "avaliar",
      organization_id: MEMBER.organizationId,
      alvo: "resposta",
      turno_id: "40000000-0000-4000-8000-000000000001",
      avaliacao: "positiva",
    }),
    deps,
    {},
  );

  assertEquals(response.status, 201);
  assertEquals(calls.map((call) => call.name), ["submit"]);
});

Deno.test("feedback — negativo exige um motivo curto conhecido", async () => {
  const { deps, calls } = setup();
  const response = await handleFeedback(
    request({
      acao: "avaliar",
      organization_id: MEMBER.organizationId,
      alvo: "conversa",
      conversa_id: "50000000-0000-4000-8000-000000000001",
      avaliacao: "negativa",
    }),
    deps,
    {},
  );

  assertEquals(response.status, 400);
  assertEquals(calls, []);
});

Deno.test("feedback — invenção tenta alertar imediatamente sem perder a avaliação se o canal cair", async () => {
  const { deps, calls } = setup();
  const response = await handleFeedback(
    request({
      acao: "avaliar",
      organization_id: MEMBER.organizationId,
      alvo: "resposta",
      turno_id: "40000000-0000-4000-8000-000000000001",
      avaliacao: "negativa",
      motivo: "invented",
      comentario: "Trouxe um faturamento que não existe.",
    }),
    deps,
    {},
  );

  assertEquals(response.status, 201);
  assertEquals(calls.map((call) => call.name), ["submit", "notify"]);
  assertEquals(await response.json(), { id: FEEDBACK_ID, alerta_enviado: false });
});

Deno.test("feedback — sinal implícito aceita somente eventos do contrato", async () => {
  const { deps, calls } = setup();
  const response = await handleFeedback(
    request({
      acao: "sinal",
      organization_id: MEMBER.organizationId,
      evento: "proposal_clicked",
      proposta_id: "60000000-0000-4000-8000-000000000001",
    }),
    deps,
    {},
  );

  assertEquals(response.status, 204);
  assertEquals(calls.map((call) => call.name), ["signal"]);
});

Deno.test("feedback — casos completos são exclusivos do Master", async () => {
  const member = setup();
  const denied = await handleFeedback(request({ acao: "listar" }), member.deps, {});
  assertEquals(denied.status, 403);
  assertEquals(member.calls, []);

  const master = setup(MASTER);
  const listed = await handleFeedback(request({ acao: "listar" }), master.deps, {});
  assertEquals(listed.status, 200);
  assertEquals(await listed.json(), { casos: [{ id: FEEDBACK_ID }] });
});

Deno.test("feedback — Master reabre caso com o rastro armazenado", async () => {
  const { deps } = setup(MASTER);
  const response = await handleFeedback(
    request({ acao: "detalhe", feedback_id: FEEDBACK_ID }),
    deps,
    {},
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    caso: { id: FEEDBACK_ID, trace: [{ name: "metricas" }] },
  });
});
