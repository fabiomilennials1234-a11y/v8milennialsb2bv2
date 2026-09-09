/**
 * SCRUM-629 (W3) · Aba "Disparos" do funil custom — contrato do toggle D11.
 *
 * Prova, na superfície:
 *  1. Toggle nasce DESLIGADO → a seção de regras NÃO renderiza (freio 1).
 *  2. Ligado → PipeDispatchRulesSection recebe pipelineId (chave real) e o
 *     slug do funil como eco.
 *  3. O clique escreve só { pipelineId, enabled } — nada de carimbo temporal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ── Mocks dos vizinhos pesados do dialog ────────────────────────────────────
vi.mock("@/modules/pipelines/hooks/custom/useCustomPipelines", () => ({
  useCreateCustomPipelineStage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomPipelineStage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCustomPipelineStage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReorderCustomPipelineStages: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomPipeline: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/engagement/hooks/useChecklistTemplates", () => ({
  useChecklistTemplates: () => ({ data: [] }),
}));
vi.mock("@/modules/pipelines/components/shared/TransitionSelector", () => ({
  TransitionSelector: () => null,
}));
vi.mock("@/modules/pipelines/components/custom/ImportCustomPipelineContent", () => ({
  ImportCustomPipelineContent: () => null,
}));
// SCRUM-636: a aba Etapas virou o editor único (hooks de sistema + custom +
// TanStack Query). Este teste é da aba DISPAROS — o editor entra como stub.
vi.mock("@/modules/pipelines/components/shared/ManagePipelineStagesModal", () => ({
  ManagePipelineStagesContent: () => <div data-testid="stages-editor" />,
}));
vi.mock("@/modules/pipelines/components/shared/FunnelIdentitySection", () => ({
  FunnelIdentitySection: () => null,
}));
vi.mock("@/modules/pipelines/components/custom/CreatePipelineModal", () => ({
  PIPELINE_COLORS: ["#3b82f6"],
  PIPELINE_ICONS: [],
}));

// Stub da seção de regras: captura as props que recebe.
const sectionProps: Array<Record<string, unknown>> = [];
vi.mock("@/modules/pipelines/components/shared/PipeDispatchRulesSection", () => ({
  PipeDispatchRulesSection: (props: Record<string, unknown>) => {
    sectionProps.push(props);
    return <div data-testid="dispatch-rules-section" />;
  },
}));

// Toggle hooks controláveis por teste.
let mockEnabled = false;
const mutateAsync = vi.fn().mockResolvedValue({});
vi.mock("@/modules/pipelines/hooks/config/useStageDispatchToggle", () => ({
  useStageDispatchEnabled: () => ({
    data: { enabled: mockEnabled, enabledAt: mockEnabled ? "2027-09-08T00:00:00Z" : null },
    isLoading: false,
  }),
  useSetStageDispatchEnabled: () => ({ mutateAsync, isPending: false }),
}));

import { CustomPipeSettingsDialog } from "@/modules/pipelines/components/custom/CustomPipeSettingsDialog";

const pipeline = {
  id: "pipe-uuid-1",
  organization_id: "org-1",
  name: "Pós-venda",
  slug: "pos-venda",
  description: null,
  icon: "kanban",
  color: "#3b82f6",
  position: 0,
  is_active: true,
  created_by: null,
  created_at: "",
  updated_at: "",
  lifecycle_type: "permanent",
  starts_at: null,
  ends_at: null,
  status: "active",
  team_goal: null,
  individual_goal: null,
  bonus_value: null,
  bonus_description: null,
  objective_pipe_type: null,
  objective_stage_key: null,
  template_type: null,
  lead_source_config: null,
  // deno/ts: shape estrutural — campos extras do contrato não usados aqui
} as never;

function renderDisparosTab() {
  render(
    <CustomPipeSettingsDialog
      open
      onOpenChange={() => {}}
      pipeline={pipeline}
      stages={[]}
    />
  );
  // Radix Tabs ativa no mousedown (jsdom não dispara a sequência completa do click)
  const tab = screen.getByRole("tab", { name: /disparos/i });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

beforeEach(() => {
  sectionProps.length = 0;
  mutateAsync.mockClear();
  mockEnabled = false;
});

describe("Aba Disparos — funil custom (D11/SCRUM-629)", () => {
  it("nasce desligado: sem seção de regras, com aviso do que o toggle liga", () => {
    renderDisparosTab();

    expect(screen.getByText(/mensagens automáticas por etapa/i)).toBeTruthy();
    expect(screen.queryByTestId("dispatch-rules-section")).toBeNull();
    expect(screen.getByText(/ative o disparo por etapa/i)).toBeTruthy();
    // Aviso explícito do corte temporal (nunca retroativo):
    expect(screen.getByText(/depois/)).toBeTruthy();

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("ligado: seção de regras renderiza chaveada por pipelineId + slug do funil", () => {
    mockEnabled = true;
    renderDisparosTab();

    expect(screen.getByTestId("dispatch-rules-section")).toBeTruthy();
    expect(sectionProps[0]).toMatchObject({
      pipelineId: "pipe-uuid-1",
      pipeType: "pos-venda",
    });
  });

  it("clicar no toggle escreve só { pipelineId, enabled } — carimbo é do servidor", () => {
    renderDisparosTab();

    fireEvent.click(screen.getByRole("switch"));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ pipelineId: "pipe-uuid-1", enabled: true });
    expect(Object.keys(mutateAsync.mock.calls[0][0])).toEqual(["pipelineId", "enabled"]);
  });
});
