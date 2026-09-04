/**
 * Painel do gatilho "Lead Respondeu".
 *
 * O que estes testes travam é a DIVULGAÇÃO PROGRESSIVA — a regra de que nada
 * aparece antes de fazer sentido. Ela não é enfeite: 43 das 62 orgs com chip
 * têm um número só, e oferecer a elas uma escolha entre números que não existem
 * é pior que não oferecer nada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pipelines = vi.fn();
const stages = vi.fn();
const instances = vi.fn();

// Dublê por SPREAD do módulo real, não por lista de exports: barrel de bounded
// context cresce, e dublê por lista quebra no primeiro export novo que o
// componente passar a usar — sem relação com o que o teste afirma.
vi.mock("@/modules/pipelines", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePipelines: () => pipelines(),
  useAllPipelineStages: () => stages(),
  // Os demais hooks do painel são dublados porque descem até `useAuth`, que
  // exige provider. O teste é sobre o painel do `lead_replied`, não sobre eles.
  usePipelineStages: () => ({ data: [] }),
  useCustomPipelines: () => ({ data: [] }),
  useCustomPipelineStages: () => ({ data: [] }),
  usePipelineDisplayConfig: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/modules/communication", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWhatsAppInstances: () => instances(),
}));

vi.mock("@/modules/campaigns/hooks/useCampanhas", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCampanhas: () => ({ data: [] }),
  useCampanhaStages: () => ({ data: [] }),
}));

vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: () => true }),
}));

import { TriggerPanel } from "@/modules/workflows/components/sidebar-panels/TriggerPanel";

const FUNIL = "11111111-1111-1111-1111-111111111111";
const OUTRO_FUNIL = "22222222-2222-2222-2222-222222222222";
const ETAPA = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function montar(config: Record<string, unknown> = {}) {
  const onUpdate = vi.fn();
  render(
    <TriggerPanel
      data={{ type: "trigger", triggerType: "lead_replied", label: "", config } as never}
      onUpdate={onUpdate}
    />,
  );
  return onUpdate;
}

beforeEach(() => {
  pipelines.mockReturnValue({
    data: [
      { id: FUNIL, name: "Propostas", is_active: true },
      { id: OUTRO_FUNIL, name: "Oportunidades", is_active: true },
    ],
  });
  stages.mockReturnValue({
    data: [
      { id: ETAPA, name: "Proposta Enviada", pipeline_id: FUNIL, is_active: true, position: 0 },
      { id: "outra", name: "Sondagem", pipeline_id: OUTRO_FUNIL, is_active: true, position: 0 },
    ],
  });
  instances.mockReturnValue({ data: [] });
});

describe("LeadRepliedConfig", () => {
  it("não oferece escolha de número quando a org tem um só", () => {
    instances.mockReturnValue({ data: [{ id: "i1", instance_name: "Comercial" }] });
    montar();
    expect(screen.queryByText("De onde")).not.toBeInTheDocument();
  });

  it("oferece a escolha de número quando há dois", () => {
    instances.mockReturnValue({
      data: [
        { id: "i1", instance_name: "Comercial" },
        { id: "i2", instance_name: "Suporte" },
      ],
    });
    montar();
    expect(screen.getByText("De onde")).toBeInTheDocument();
    expect(screen.getByText("Comercial")).toBeInTheDocument();
  });

  it("só mostra etapas depois de um funil marcado", () => {
    montar();
    expect(screen.queryByText("Proposta Enviada")).not.toBeInTheDocument();

    montar({ pipeline_ids: [FUNIL] });
    expect(screen.getByText("Proposta Enviada")).toBeInTheDocument();
  });

  it("mostra só as etapas dos funis marcados", () => {
    montar({ pipeline_ids: [FUNIL] });
    expect(screen.getByText("Proposta Enviada")).toBeInTheDocument();
    expect(screen.queryByText("Sondagem")).not.toBeInTheDocument();
  });

  it("a janela do after_outbound só existe nesse modo", () => {
    montar({ reply_mode: "any" });
    expect(screen.queryByLabelText(/dentro de/i)).not.toBeInTheDocument();

    montar({ reply_mode: "after_outbound" });
    expect(screen.getByLabelText(/dentro de/i)).toBeInTheDocument();
  });

  it("o silêncio do first_of_thread só existe nesse modo", () => {
    montar({ reply_mode: "first_of_thread" });
    expect(screen.getByLabelText(/conversa nova após/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/dentro de/i)).not.toBeInTheDocument();
  });

  it("o cooldown está sempre visível, com 60 como padrão", () => {
    montar();
    expect(screen.getByLabelText(/não repetir por/i)).toHaveValue(60);
  });

  // Desmarcar um funil não pode deixar para trás a etapa dele marcada — o
  // filtro ficaria restrito a uma etapa invisível na tela.
  it("desmarcar o funil leva junto as etapas dele", async () => {
    const onUpdate = montar({ pipeline_ids: [FUNIL], stage_ids: [ETAPA] });
    await userEvent.click(screen.getByRole("checkbox", { name: /Propostas/ }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ pipeline_ids: [], stage_ids: [] }),
      }),
    );
  });
});
