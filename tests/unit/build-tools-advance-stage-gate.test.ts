/**
 * buildDynamicTools — o gate da ferramenta `advance_stage` lê a coluna QUE EXISTE.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ───────────────────────────────────────────
 * `capabilities` aqui é a ROW de `copilot_agents` (`SELECT_AGENT` = `"*, …"`,
 * em `_shared/copilot/context-loader.ts`). Nessa tabela a coluna chama-se
 * **`can_move_cards`**. `can_move_stage` é o nome do v2, onde o objeto é montado
 * à mão em `copilot-v2-worker/index.ts`.
 *
 * O commit 73f17a476 (07/09/2026, "feat(pipe): unify funnel references across
 * product") trocou o gate de `can_qualify_lead` para `can_move_stage`. Como a
 * coluna não existe no v1, a expressão passou a valer `undefined` para TODO
 * agente v1 — e a ferramenta deixou de ser registrada. A IA não perdeu a
 * permissão: perdeu a ferramenta, sem erro, sem log, sem sintoma no CRM.
 *
 * O silêncio é o ponto: `agent_decision_logs` registra a ação DECIDIDA, e sem
 * ferramenta não há decisão para registrar. Medido em prod em 29/09/2026 —
 * `ADVANCE_STAGE` não aparece **uma única vez** na tabela inteira (1.373 linhas,
 * desde 30/08), em nenhuma das orgs. Um gate que lê campo inexistente reprova
 * sempre e não deixa rastro, então nenhum teste que só olhasse o caminho feliz
 * o denunciaria — é por isso que a prova tem de ser sobre o NOME do campo.
 *
 * Os casos abaixo fixam as três combinações que importam:
 *   1. v1 (`can_move_cards: true`, sem `can_move_stage`) → ferramenta EXISTE;
 *   2. v2 (`can_move_stage: false` explícito) → ferramenta AUSENTE, mesmo com
 *      `can_move_cards: true` — desligar no v2 é decisão, não omissão (`??`);
 *   3. sem nenhuma das duas → ferramenta AUSENTE.
 */

import { describe, it, expect } from "vitest";
import { buildDynamicTools, type BuildToolsParams } from "../../supabase/functions/agent-message/engine/build-tools.ts";

const PIPELINE_ID = "dc8c601c-88d8-42a6-9202-90f5e20ff872";

/** A forma da ferramenta que este arquivo inspeciona (nome + enum do funil). */
interface ToolShape {
  name: string;
  description: string;
  input_schema: { properties: { target_pipe?: { enum?: string[] } } };
}

/** Supabase mínimo: nenhuma tabela lida por este caminho precisa devolver linha. */
function makeSupabase(): BuildToolsParams["supabase"] {
  type Chain = Record<string, unknown>;
  const from = () => {
    const chain: Chain = {};
    chain.select = () => chain;
    for (const m of ["eq", "in", "order", "limit"]) chain[m] = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject);
    return chain;
  };
  return { from } as unknown as BuildToolsParams["supabase"];
}

/** Etapas do funil custom da org — `pipeline_type` NULL, como nasce todo funil de fábrica. */
const STAGES = [
  { stage_key: "em_conversa", name: "Em conversa", pipeline_type: null, pipeline_id: PIPELINE_ID, pipeline_slug: "vendas", pipeline_name: "Funil de Vendas" },
  { stage_key: "aguardando_vendedor", name: "Aguardando vendedor", pipeline_type: null, pipeline_id: PIPELINE_ID, pipeline_slug: "vendas", pipeline_name: "Funil de Vendas" },
];

function params(capabilities: Record<string, unknown>): BuildToolsParams {
  return {
    supabase: makeSupabase(),
    organizationId: "org-1",
    capabilities: {
      id: "agent-1",
      active_pipes: [PIPELINE_ID],
      active_stages: { [PIPELINE_ID]: ["em_conversa", "aguardando_vendedor"] },
      ...capabilities,
    },
    orgCustomFields: [],
    pipelineStages: STAGES,
  };
}

const findAdvance = (tools: unknown[]): ToolShape | undefined =>
  (tools as ToolShape[]).find((t) => t.name === "advance_stage");

describe("buildDynamicTools — gate de advance_stage (regressão 73f17a476)", () => {
  it("agente v1 com can_move_cards=true RECEBE a ferramenta (a coluna can_move_stage não existe)", async () => {
    const tools = await buildDynamicTools(params({ can_move_cards: true }));
    const advance = findAdvance(tools);

    expect(advance).toBeDefined();
    // O funil custom entra pelo slug real, não como "whatsapp".
    expect(advance!.input_schema.properties.target_pipe?.enum).toEqual(["vendas"]);
    expect(advance!.description).toContain("aguardando_vendedor");
  });

  it("v2 com can_move_stage=false NÃO recebe a ferramenta, mesmo com can_move_cards=true", async () => {
    // `??` e não `||`: desligar explicitamente no v2 tem de vencer o nome do v1.
    const tools = await buildDynamicTools(
      params({ can_move_stage: false, can_move_cards: true }),
    );
    expect(findAdvance(tools)).toBeUndefined();
  });

  it("v2 com can_move_stage=true recebe a ferramenta", async () => {
    const tools = await buildDynamicTools(params({ can_move_stage: true }));
    expect(findAdvance(tools)).toBeDefined();
  });

  it("sem nenhuma das duas flags, a ferramenta não é registrada", async () => {
    const tools = await buildDynamicTools(params({}));
    expect(findAdvance(tools)).toBeUndefined();
  });

  it("etapa fora de active_stages não é oferecida — o recorte do agente é respeitado", async () => {
    const tools = await buildDynamicTools({
      ...params({ can_move_cards: true }),
      capabilities: {
        id: "agent-1",
        can_move_cards: true,
        active_pipes: [PIPELINE_ID],
        active_stages: { [PIPELINE_ID]: ["em_conversa"] },
      },
    });
    const advance = findAdvance(tools);

    expect(advance).toBeDefined();
    expect(advance!.description).toContain("em_conversa");
    expect(advance!.description).not.toContain("aguardando_vendedor");
  });
});
