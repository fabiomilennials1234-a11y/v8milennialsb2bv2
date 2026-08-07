/**
 * SCRUM-98 — `{{estagio}}` vem do NEGÓCIO nos dois leitores que ficaram sem prova.
 *
 * O commit b55a8881 trocou a fonte da etapa em 5 leitores dentro de 4 arquivos de
 * `_shared`. Três já têm rede:
 *
 *   • `action-handlers/whatsapp-helpers.ts`   → `shared-action-handler-branches.test.ts`
 *                                               + a suíte Deno `whatsapp-helpers-estagio.test.ts`
 *   • `workflow-condition-evaluator.ts`       → `workflow-condition-evaluator-branches.test.ts`
 *
 * Os dois de baixo não tinham nenhuma, e a PR #1460 os deixou de fora de
 * propósito (o fan-out devolveu fragmento onde o schema pedia arquivo completo,
 * e importar fragmento é pior que não importar). Este arquivo fecha os dois,
 * escrito direto:
 *
 *   • `workflow-action-handler.ts`  → `resolveVariables`, privada; porta pública
 *                                     `executeWorkflowAction` com `update_lead_field`
 *   • `workflow-executor.ts`        → `resolveWebhookBody`, privada; porta pública
 *                                     `executeWorkflow` com um nó `webhook_call`
 *
 * O QUE ESTES CASOS PRECISAM PROVAR, E POR QUÊ
 * --------------------------------------------
 * O modo de falha aqui NÃO é "a etapa some". É "a etapa MENTE".
 *
 * `sync_pipeline_entry_to_lead_pipe_whatsapp` resolve o slug por
 * `NEW.pipeline_id`. Quando o negócio sai de Oportunidades por MOVE (decisão 4
 * do ADR-0023 troca o antigo DELETE por um UPDATE), o slug já é `propostas`, a
 * função não escreve, e `leads.pipe_whatsapp` **congela** na última etapa de
 * whatsapp em vez de esvaziar.
 *
 * Vazio degrada de boa: variável não renderiza, regra não casa. Congelado mente
 * de forma plausível — o cliente recebe "você está em Agendado" estando em
 * Proposta enviada, e nada na tela denuncia.
 *
 * Por isso o caso central de cada leitor é o do ESPELHO CARREGADO E ENTRY
 * AUSENTE: é o estado exato do lead depois do move. Um caso que só afirma
 * "com entry, resolve a entry" continua verde se alguém reintroduzir
 * `lead.pipe_whatsapp` como fallback — que é a regressão real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";

// A entry do funil é a FONTE. O mock devolve o que cada caso semeia, e a
// ausência de chave é "lead sem negócio nesse funil" — o estado pós-move.
const { pipeEntries } = vi.hoisted(() => ({ pipeEntries: {} as Record<string, unknown> }));

vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn(
    async (_sb: unknown, _leadId: string, _orgId: string, slug: string) => pipeEntries[slug] ?? null,
  ),
  getPipeEntriesByLeads: vi.fn().mockResolvedValue([]),
  resolvePipelineId: vi.fn().mockResolvedValue(null),
  upsertPipeEntry: vi.fn().mockResolvedValue({ status: "updated" }),
}));

// O espião que captura o valor JÁ RESOLVIDO. `update_lead_field` é a porta
// pública mais curta até a `resolveVariables` privada do action-handler: ela
// resolve o `fieldValue` e entrega aqui.
const { updateLeadFieldSpy } = vi.hoisted(() => ({
  updateLeadFieldSpy: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../../supabase/functions/_shared/action-handlers/lead-field-operations.ts", () => ({
  updateLeadField: updateLeadFieldSpy,
  updateCustomField: vi.fn().mockResolvedValue({ success: true }),
  updateRating: vi.fn().mockResolvedValue({ success: true }),
}));

// O executor não é o assunto destes casos — só a resolução do corpo do webhook.
vi.mock("../../supabase/functions/_shared/workflow-condition-evaluator.ts", () => ({
  evaluateCondition: vi.fn().mockResolvedValue(true),
  getLeadTags: vi.fn().mockResolvedValue(""),
}));

import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";
import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";
import { createMockSupabase } from "../helpers/supabase-mock";

/**
 * Fixture SEM `pipe_whatsapp`. Deliberado: manter a coluna no lead "normal"
 * esconderia a regressão, porque o caso passaria de novo no dia em que alguém a
 * reintroduzisse como fallback. Quem precisa dela é só o caso do espelho
 * congelado, e lá ela entra explicitamente.
 */
const LEAD = {
  id: "lead-1",
  organization_id: "org-1",
  name: "Bar do Zé",
  company: "Bar do Zé Ltda",
  email: "ze@bar.com",
  phone: "5511999999999",
};

beforeEach(() => {
  vi.clearAllMocks();
  updateLeadFieldSpy.mockResolvedValue({ success: true });
  for (const k of Object.keys(pipeEntries)) delete pipeEntries[k];
});

// ─────────────────────────────────────────────────────────────────────────────
// Leitor 4 — workflow-action-handler.ts :: resolveVariables
// ─────────────────────────────────────────────────────────────────────────────

/** Roda `update_lead_field` com o template pedido e devolve o valor resolvido. */
async function resolverPorAcao(template: string, lead: Record<string, unknown>) {
  const { sb, mockTable } = createMockSupabase();
  mockTable("leads", [lead]);
  mockTable("team_members", []);
  mockTable("organizations", [{ id: "org-1", name: "Milennials" }]);

  await executeWorkflowAction({
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    nodeData: { actionType: "update_lead_field", fieldName: "notes", fieldValue: template },
    executionContext: {},
  });

  expect(updateLeadFieldSpy).toHaveBeenCalled();
  return updateLeadFieldSpy.mock.calls[0][0].params.fieldValue as string;
}

describe("workflow-action-handler :: {{estagio}} vem do negócio", () => {
  it("resolve a etapa da entry do funil WhatsApp", async () => {
    pipeEntries.whatsapp = { id: "e1", stage_key: "agendado", closed_at: null };

    expect(await resolverPorAcao("[{{estagio}}]", LEAD)).toBe("[agendado]");
  });

  it("🔴 espelho legado CONGELADO não vira etapa — sai vazio", async () => {
    // Estado exato do lead depois do MOVE: a coluna guarda "compareceu" (última
    // etapa de whatsapp antes de sair) e não existe mais entry no funil. Se a
    // função voltar a ler a coluna, este caso passa a devolver "[compareceu]" —
    // uma etapa que o negócio não ocupa. É a mutação que importa.
    const congelado = { ...LEAD, pipe_whatsapp: "compareceu" };

    expect(await resolverPorAcao("[{{estagio}}]", congelado)).toBe("[]");
  });

  it("lead sem negócio e sem espelho também sai vazio, sem estourar a ação", async () => {
    expect(await resolverPorAcao("[{{estagio}}]", LEAD)).toBe("[]");
  });

  it("as outras variáveis continuam resolvendo — a remoção foi cirúrgica", async () => {
    pipeEntries.whatsapp = { id: "e1", stage_key: "abordado", closed_at: null };

    expect(await resolverPorAcao("{{nome}} / {{empresa}} / {{estagio}}", LEAD))
      .toBe("Bar do Zé / Bar do Zé Ltda / abordado");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Leitor 5 — workflow-executor.ts :: resolveWebhookBody
// ─────────────────────────────────────────────────────────────────────────────

/** Dispara um `webhook_call` com o corpo pedido e devolve o body que saiu no POST. */
async function resolverPorWebhook(template: string, lead: Record<string, unknown>) {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("ok", { status: 200 }));

  const { sb, mockTable } = createMockSupabase();
  mockTable("workflow_execution_steps", []);
  mockTable("workflow_executions", []);
  mockTable("leads", [lead]);
  mockTable("team_members", []);
  mockTable("organizations", [{ id: "org-1", name: "Milennials" }]);

  try {
    await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition: {
        nodes: [
          { id: "t1", type: "trigger", data: {} },
          {
            id: "wh1",
            type: "webhook_call",
            data: { url: "https://x/hook", method: "POST", bodyTemplate: template },
          },
        ],
        edges: [{ id: "e1", source: "t1", target: "wh1" }],
      },
      loopLimit: 10,
      context: {},
    });

    expect(fetchSpy).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    return String(init.body ?? "");
  } finally {
    fetchSpy.mockRestore();
  }
}

describe("workflow-executor :: corpo do webhook carrega a etapa do negócio", () => {
  it("resolve a etapa da entry do funil WhatsApp", async () => {
    pipeEntries.whatsapp = { id: "e1", stage_key: "respondeu", closed_at: null };

    const body = await resolverPorWebhook('{"etapa":"{{estagio}}"}', LEAD);

    expect(JSON.parse(body).etapa).toBe("respondeu");
  });

  it("🔴 espelho legado CONGELADO não vaza para o webhook — sai vazio", async () => {
    // Um webhook que entrega etapa velha é pior que um que entrega vazio: o
    // sistema do outro lado guarda o valor e ninguém compara com o funil.
    const congelado = { ...LEAD, pipe_whatsapp: "compareceu" };

    const body = await resolverPorWebhook('{"etapa":"{{estagio}}"}', congelado);

    expect(JSON.parse(body).etapa).toBe("");
  });

  it("lead sem negócio no funil manda etapa vazia, e o POST acontece do mesmo jeito", async () => {
    const body = await resolverPorWebhook('{"etapa":"{{estagio}}","nome":"{{nome}}"}', LEAD);

    expect(JSON.parse(body)).toEqual({ etapa: "", nome: "Bar do Zé" });
  });
});
