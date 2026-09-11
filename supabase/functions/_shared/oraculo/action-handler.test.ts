import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { ActionExecutionError, handleAction } from "./action-handler.ts";

const PROPOSAL = "30000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000001";
const ACTOR = {
  userId: "20000000-0000-4000-8000-000000000001",
  teamMemberId: "40000000-0000-4000-8000-000000000001",
  organizationId: ORG,
  role: "member",
  isMaster: false,
  isAdmin: false,
};

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/functions/v1/oraculo-action", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

Deno.test("ação HTTP — sem proposta válida nenhuma escrita começa", async () => {
  let executed = false;
  const response = await handleAction(request({ organization_id: ORG }), {
    auth: () => Promise.resolve(ACTOR),
    execute: () => {
      executed = true;
      return Promise.resolve({ status: "aviso", alterados: 0 });
    },
  }, {});

  assertEquals(response.status, 400);
  assertEquals(executed, false);
});

Deno.test("ação HTTP — permissão recusada no clique volta como 403", async () => {
  const response = await handleAction(request({ organization_id: ORG, proposta_id: PROPOSAL }), {
    auth: () => Promise.resolve(ACTOR),
    execute: () => Promise.reject(new ActionExecutionError(403, "permissao_recusada")),
  }, {});

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "permissao_recusada" });
});

Deno.test("ação HTTP — alvos que mudaram são reportados como já tratados", async () => {
  const result = {
    status: "sucesso" as const,
    previstos: 5,
    qualificaveis_no_clique: 3,
    alterados: 3,
    ja_tratados: 2,
  };
  const response = await handleAction(request({ organization_id: ORG, proposta_id: PROPOSAL }), {
    auth: () => Promise.resolve(ACTOR),
    execute: (_actor, proposalId) => {
      assertEquals(proposalId, PROPOSAL);
      return Promise.resolve(result);
    },
  }, {});

  assertEquals(response.status, 200);
  assertEquals(await response.json(), result);
});

Deno.test("ação HTTP — nenhum alvo elegível produz aviso explícito", async () => {
  const result = {
    status: "aviso" as const,
    previstos: 4,
    qualificaveis_no_clique: 0,
    alterados: 0,
    ja_tratados: 4,
  };
  const response = await handleAction(request({ organization_id: ORG, proposta_id: PROPOSAL }), {
    auth: () => Promise.resolve(ACTOR),
    execute: () => Promise.resolve(result),
  }, {});

  assertEquals(response.status, 200);
  assertEquals(await response.json(), result);
});
