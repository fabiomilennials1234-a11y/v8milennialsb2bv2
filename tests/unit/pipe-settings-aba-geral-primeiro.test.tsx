/**
 * "Geral" é a PRIMEIRA aba dos dois diálogos de configuração — e é onde eles
 * abrem.
 *
 * Identidade antes de mecânica. Renomear e excluir um funil moravam na última
 * aba: sétima de sete no funil de fábrica, quarta de quatro no personalizado.
 * Quem procurava não achava.
 *
 * O que trava aqui:
 *   1. **ordem** — "Geral" encabeça a lista de abas nos dois diálogos;
 *   2. **aba inicial** — o diálogo abre nela, não em "Etapas";
 *   3. **a Carteira não regride** — `upsell_*` não tem linha canônica em
 *      `pipelines` e portanto não tem "Geral"; lá o início continua "Etapas".
 *      Sem esta asserção, o novo default abriria numa aba inexistente e a
 *      Carteira nasceria em branco;
 *   4. **`defaultTab` explícito continua mandando** — a Carteira abre o
 *      diálogo direto em "Importar" em dois call sites.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Vizinhos pesados: só o diálogo está sob teste ───────────────────────────
vi.mock("@/modules/pipelines/components/shared/ManagePipelineStagesModal", () => ({
  ManagePipelineStagesContent: () => <div data-testid="stages-editor" />,
}));
vi.mock("@/modules/pipelines/components/shared/FunnelIdentitySection", () => ({
  FunnelIdentitySection: () => <div data-testid="identity-section" />,
}));
vi.mock("@/modules/pipelines/components/shared/PipeDispatchRulesSection", () => ({
  PipeDispatchRulesSection: () => null,
}));
vi.mock("@/modules/pipelines/components/shared/PipeDistributionSection", () => ({
  PipeDistributionSection: () => null,
}));
vi.mock("@/modules/pipelines/components/custom/ImportCustomPipelineContent", () => ({
  ImportCustomPipelineContent: () => null,
}));
vi.mock("@/modules/leads", () => ({
  CustomFieldsManager: () => null,
  ImportLeadsFunnelContent: () => <div data-testid="import-leads" />,
  ExportLeadsContent: () => null,
}));
vi.mock("@/modules/pipelines/hooks/config/useStageDispatchToggle", () => ({
  useStageDispatchEnabled: () => ({ data: { enabled: false }, isLoading: false }),
  useSetStageDispatchEnabled: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const PIPELINE_SISTEMA = {
  id: "p-sys",
  slug: "whatsapp",
  type: "system",
  name: "Qualificação",
  icon: "target",
  color: "#3b82f6",
  is_active: true,
};
vi.mock("@/modules/pipelines/hooks/model/usePipelines", () => ({
  usePipelines: () => ({ data: [PIPELINE_SISTEMA], isLoading: false }),
}));
vi.mock("@/modules/pipelines/hooks/config/usePipelineDisplayConfig", () => ({
  usePipelineDisplayConfig: () => ({
    data: [{ pipe_type: "whatsapp", display_name: "Oportunidades", is_visible: true }],
    isLoading: false,
  }),
}));

import { PipeSettingsDialog } from "@/modules/pipelines/components/shared/PipeSettingsDialog";
import { CustomPipeSettingsDialog } from "@/modules/pipelines/components/custom/CustomPipeSettingsDialog";

const abas = () => screen.getAllByRole("tab").map((t) => t.textContent?.trim());
const abaAtiva = () => screen.getByRole("tab", { selected: true }).textContent?.trim();

const pipelineCustom = {
  id: "c1",
  name: "Pós-venda",
  slug: "pos-venda",
  icon: "kanban",
  color: "#22c55e",
} as never;

describe("Aba Geral primeiro — funil de fábrica", () => {
  it("encabeça as sete abas e é onde o diálogo abre", () => {
    render(
      <PipeSettingsDialog open onOpenChange={() => {}} pipeType="whatsapp" stages={[]} />,
    );

    expect(abas()).toEqual([
      "Geral",
      "Etapas",
      "Campos",
      "Distribuição",
      "Importar",
      "Exportar",
      "Disparos",
    ]);
    expect(abaAtiva()).toBe("Geral");
    expect(screen.getByTestId("identity-section")).toBeTruthy();
  });

  it("`defaultTab` explícito continua vencendo o novo padrão", () => {
    render(
      <PipeSettingsDialog
        open
        onOpenChange={() => {}}
        pipeType="whatsapp"
        stages={[]}
        defaultTab="importar"
      />,
    );

    expect(abaAtiva()).toBe("Importar");
  });
});

describe("Carteira (upsell) — sem Geral, e sem regressão", () => {
  it("upsell_base não ganha aba Geral e continua abrindo em Etapas", () => {
    render(
      <PipeSettingsDialog
        open
        onOpenChange={() => {}}
        pipeType="upsell_base"
        stages={[]}
        upsellRulesSlot={<div />}
        upsellImportSlot={<div />}
      />,
    );

    expect(abas()).toEqual(["Etapas", "Regras", "Importar"]);
    expect(abaAtiva()).toBe("Etapas");
    expect(screen.getByTestId("stages-editor")).toBeTruthy();
  });
});

describe("Aba Geral primeiro — funil personalizado", () => {
  it("encabeça as quatro abas e é onde o diálogo abre", () => {
    render(
      <CustomPipeSettingsDialog
        open
        onOpenChange={() => {}}
        pipeline={pipelineCustom}
        stages={[]}
      />,
    );

    expect(abas()).toEqual(["Geral", "Etapas", "Disparos", "Importar"]);
    expect(abaAtiva()).toBe("Geral");
    expect(screen.getByTestId("identity-section")).toBeTruthy();
  });
});
