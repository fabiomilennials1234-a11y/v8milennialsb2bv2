/**
 * Score/rating do lead descontinuados em Automações (CTO, 2026-10-02).
 *
 * Duas metades do mesmo contrato:
 *  1. Nenhuma superfície de CRIAÇÃO oferece mais os passos (catálogo de
 *     gatilhos, de ações, inseridor de variáveis, campo do condicional guiado).
 *  2. Workflow JÁ SALVO com esses passos continua renderizando — com o selo
 *     "Descontinuado" — em vez de quebrar ou ficar em branco.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import {
  ACTION_CATEGORIES,
  ACTION_LABELS,
  DISCONTINUED_STEP_HINT,
  TRIGGER_CATEGORIES,
  TRIGGER_LABELS,
  WORKFLOW_VARIABLES,
  getActionCategories,
  isDiscontinuedAction,
  isDiscontinuedTrigger,
} from "@/types/workflow";
import { DISCONTINUED_GUIDED_FIELDS, GUIDED_NUMBER_FIELDS } from "@/contracts/workflows/guided-fields";
import { countDiscontinuedSteps, isDiscontinuedNode } from "@/modules/workflows/lib/discontinued-steps";
import { summarizeGuidedCondition } from "@/modules/workflows/lib/guided-condition-summary";
import { TriggerNode } from "@/modules/workflows/components/nodes/TriggerNode";
import { ActionNode } from "@/modules/workflows/components/nodes/ActionNode";
import type { NodeProps } from "@xyflow/react";

vi.mock("@xyflow/react", async (orig) => ({
  ...(await orig<typeof import("@xyflow/react")>()),
  Handle: () => null,
}));

const nodeProps = (id: string, data: Record<string, unknown>) =>
  ({ id, data, selected: false, type: "x", dragging: false, zIndex: 0, isConnectable: true,
    positionAbsoluteX: 0, positionAbsoluteY: 0, selectable: true, deletable: true, draggable: true }) as unknown as NodeProps;

describe("catálogos de criação não oferecem score/rating", () => {
  it("gatilho Score Atingido saiu do catálogo, mas o rótulo segue resolvível", () => {
    const offered = TRIGGER_CATEGORIES.flatMap((c) => c.triggers);
    expect(offered).not.toContain("score_reached");
    expect(isDiscontinuedTrigger("score_reached")).toBe(true);
    expect(TRIGGER_LABELS.score_reached).toBeTruthy();
  });

  it("ações Atualizar Rating e Calcular Lead Score saíram dos dois regimes do picker", () => {
    for (const unified of [false, true]) {
      const offered = getActionCategories(unified).flatMap((c) => c.actions);
      expect(offered).not.toContain("update_rating");
      expect(offered).not.toContain("calculate_score");
    }
    expect(ACTION_CATEGORIES.flatMap((c) => c.actions)).not.toContain("update_rating");
    expect(isDiscontinuedAction("update_rating")).toBe(true);
    expect(isDiscontinuedAction("calculate_score")).toBe(true);
    expect(ACTION_LABELS.update_rating).toBeTruthy();
    expect(ACTION_LABELS.calculate_score).toBeTruthy();
  });

  it("inseridor de variáveis não oferece {{score}}, {{rating}} nem {{ai_temperatura}}", () => {
    const keys = WORKFLOW_VARIABLES.map((v) => v.key);
    expect(keys).not.toContain("{{score}}");
    expect(keys).not.toContain("{{rating}}");
    expect(keys).not.toContain("{{ai_temperatura}}");
  });

  it("campo guiado de score é descontinuado na UI, mas segue no contrato do executor", () => {
    expect(DISCONTINUED_GUIDED_FIELDS.has("lead.qualification_score")).toBe(true);
    // O executor importa este contrato e ainda avalia condições salvas.
    expect(GUIDED_NUMBER_FIELDS).toHaveProperty("lead.qualification_score");
  });
});

describe("workflow salvo com passos descontinuados continua legível", () => {
  const definition = {
    nodes: [
      { id: "t", type: "trigger", data: { type: "trigger", triggerType: "score_reached", config: { min_score: 50 } } },
      { id: "a1", type: "action", data: { type: "action", actionType: "update_rating", ratingValue: 8 } },
      { id: "a2", type: "action", data: { type: "action", actionType: "calculate_score" } },
      { id: "c1", type: "condition", data: { type: "condition", field: "score", operator: "greater_than", value: "50" } },
      { id: "c2", type: "condition", data: { type: "condition", guidedCondition: { version: 1, id: "g", kind: "group", match: "all",
        children: [{ version: 1, id: "r", field: "lead.qualification_score", operator: "greater_than", value: 70 }] } } },
      { id: "ok", type: "action", data: { type: "action", actionType: "add_tag" } },
    ],
    edges: [],
  };

  it("conta os cinco passos descontinuados e ignora o resto", () => {
    expect(countDiscontinuedSteps(definition)).toBe(5);
    expect(isDiscontinuedNode(definition.nodes[5])).toBe(false);
    expect(countDiscontinuedSteps(null)).toBe(0);
    expect(countDiscontinuedSteps({ nodes: "lixo" })).toBe(0);
  });

  it("o resumo do condicional guiado marca o campo como descontinuado", () => {
    expect(summarizeGuidedCondition({ version: 1, id: "r", field: "lead.qualification_score", operator: "greater_than", value: 70 } as never))
      .toContain("(descontinuado)");
  });

  it("nó de gatilho Score Atingido renderiza com selo e dica", () => {
    render(<ReactFlowProvider><TriggerNode {...nodeProps("t", { triggerType: "score_reached", label: "Gatilho" })} /></ReactFlowProvider>);
    expect(screen.getByText("Score Atingido")).toBeInTheDocument();
    expect(screen.getByText("Descontinuado")).toBeInTheDocument();
    expect(screen.getByText(DISCONTINUED_STEP_HINT)).toBeInTheDocument();
  });

  it("nó de ação Atualizar Rating renderiza com selo; ação ativa não ganha selo", () => {
    const { unmount } = render(<ReactFlowProvider><ActionNode {...nodeProps("a1", { actionType: "update_rating", label: "Rating" })} /></ReactFlowProvider>);
    expect(screen.getByText("Atualizar Rating")).toBeInTheDocument();
    expect(screen.getByText("Descontinuado")).toBeInTheDocument();
    unmount();
    render(<ReactFlowProvider><ActionNode {...nodeProps("ok", { actionType: "add_tag", label: "Tag" })} /></ReactFlowProvider>);
    expect(screen.queryByText("Descontinuado")).not.toBeInTheDocument();
  });
});
