import { assertEquals, assertMatch } from "jsr:@std/assert@^1.0.0";
import { proporAcaoTool } from "./propor-acao.ts";
import type { OracleScope } from "../scope.ts";

const scope: OracleScope = {
  kind: "organization",
  organizationId: "10000000-0000-4000-8000-000000000001",
  teamMemberId: null,
};

Deno.test("propor_acao — só prevê; não executa escrita", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const result = await proporAcaoTool.execute(
    {
      acao: "adicionar_tag",
      criterio: "leads_parados",
      dias: 14,
      tag: "Prioridade",
    },
    scope,
    {
      db: {
        rpc: (name: string, params: Record<string, unknown>) => {
          calls.push({ name, params });
          return Promise.resolve({
            data: {
              previsao: 5,
              parametros_resolvidos: { tag_id: "20000000-0000-4000-8000-000000000001" },
            },
            error: null,
          });
        },
      },
      randomUUID: () => "30000000-0000-4000-8000-000000000001",
    },
  );

  assertEquals(calls.map((call) => call.name), ["oraculo_preview_action_proposal"]);
  assertEquals(result, {
    kind: "oraculo_action_proposal",
    id: "30000000-0000-4000-8000-000000000001",
    acao: "adicionar_tag",
    criterio: { tipo: "leads_parados", dias: 14 },
    parametros: { tag_id: "20000000-0000-4000-8000-000000000001" },
    previsao: 5,
    status: "pendente",
  });
});

Deno.test("propor_acao — entrada fora do catálogo não toca no banco", async () => {
  let touched = false;
  const result = await proporAcaoTool.execute(
    {
      acao: "excluir_leads",
      criterio: "todos",
    },
    scope,
    {
      db: {
        rpc: () => {
          touched = true;
          return Promise.resolve({ data: null, error: null });
        },
      },
      randomUUID: crypto.randomUUID,
    },
  );

  assertEquals(touched, false);
  assertMatch(String((result as { error?: string }).error), /acao_invalida/);
});

Deno.test("propor_acao — contagem é previsão, nunca promessa", async () => {
  const result = await proporAcaoTool.execute(
    {
      acao: "criar_follow_up",
      criterio: "leads_sem_contato",
      titulo: "Retomar contato",
      prazo_dias: 2,
    },
    scope,
    {
      db: {
        rpc: () =>
          Promise.resolve({
            data: {
              previsao: 0,
              parametros_resolvidos: { titulo: "Retomar contato", prazo_dias: 2 },
            },
            error: null,
          }),
      },
      randomUUID: () => "30000000-0000-4000-8000-000000000002",
    },
  );

  assertEquals((result as { previsao?: number }).previsao, 0);
  assertEquals((result as { status?: string }).status, "pendente");
});
