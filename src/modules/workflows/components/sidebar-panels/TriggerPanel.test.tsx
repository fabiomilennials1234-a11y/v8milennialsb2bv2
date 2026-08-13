/**
 * TriggerPanel — testes do painel do trigger "Lead Respondeu" (lead_replied).
 *
 * Foco no filtro por funil: a lista vem de `usePipelines()`, que devolve a UNIÃO
 * de funis padrão e custom (a tabela `pipelines` espelha `custom_pipelines` com
 * o mesmo uuid). O painel grava `pipeline_ids` — uuids, nunca slugs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────
// Só `usePipelines` importa para o lead_replied; os demais existem porque o
// TriggerPanel os importa no topo do módulo.

const mockPipelines = vi.fn();

vi.mock("@/modules/pipelines", () => ({
  usePipelines: () => mockPipelines(),
  useCustomPipelines: () => ({ data: [] }),
  useCustomPipelineStages: () => ({ data: [] }),
  usePipelineStages: () => ({ data: [] }),
  getPipelineTypeName: (t: string) => t,
}));

vi.mock("@/modules/campaigns/hooks/useCampanhas", () => ({
  useCampanhas: () => ({ data: [] }),
  useCampanhaStages: () => ({ data: [] }),
}));

vi.mock("@/modules/leads", () => ({
  useLeadOrigins: () => ({ data: [] }),
}));

vi.mock("./CampaignSelectorField", () => ({
  CampaignSelectorField: () => null,
}));

import { TriggerPanel } from "./TriggerPanel";
import type { TriggerNodeData } from "@/types/workflow";

// ── Fixtures ─────────────────────────────────────────────

const QUALIFICACAO = "11111111-1111-1111-1111-111111111111";
const PROPOSTAS = "22222222-2222-2222-2222-222222222222";
const BLACK_FRIDAY = "33333333-3333-3333-3333-333333333333";
const ARQUIVADO = "44444444-4444-4444-4444-444444444444";

const PIPELINES = [
  { id: QUALIFICACAO, name: "Qualificação", type: "system", is_active: true },
  { id: PROPOSTAS, name: "Propostas", type: "system", is_active: true },
  { id: BLACK_FRIDAY, name: "Black Friday", type: "custom", is_active: true },
  { id: ARQUIVADO, name: "Funil Antigo", type: "custom", is_active: false },
];

function renderPanel(config: Record<string, unknown> = {}) {
  const onUpdate = vi.fn();
  const data = {
    type: "trigger",
    triggerType: "lead_replied",
    label: "Trigger",
    config,
  } as unknown as TriggerNodeData;

  render(<TriggerPanel data={data} onUpdate={onUpdate} />);
  return { onUpdate };
}

/** O config resultante da última chamada de onUpdate. */
function lastConfig(onUpdate: ReturnType<typeof vi.fn>) {
  return onUpdate.mock.calls.at(-1)?.[0]?.config as Record<string, unknown>;
}

function checkboxFor(name: string): HTMLElement {
  const label = screen.getByText(name).closest("label");
  if (!label) throw new Error(`Sem label para "${name}"`);
  const box = label.querySelector('[role="checkbox"]');
  if (!box) throw new Error(`Sem checkbox para "${name}"`);
  return box as HTMLElement;
}

// ── Testes ───────────────────────────────────────────────

describe("TriggerPanel — lead_replied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipelines.mockReturnValue({ data: PIPELINES });
  });

  it("mostra os três campos do trigger", () => {
    renderPanel();
    expect(screen.getByText("Canal")).toBeInTheDocument();
    expect(screen.getByText("Funis (opcional)")).toBeInTheDocument();
    expect(screen.getByText("Contém texto (opcional)")).toBeInTheDocument();
  });

  it("agrupa funis padrão e custom", () => {
    renderPanel();
    expect(screen.getByText("Funis Padrão")).toBeInTheDocument();
    expect(screen.getByText("Funis Custom")).toBeInTheDocument();
    expect(screen.getByText("Qualificação")).toBeInTheDocument();
    expect(screen.getByText("Black Friday")).toBeInTheDocument();
  });

  it("marcar um funil grava o uuid em pipeline_ids", () => {
    const { onUpdate } = renderPanel();
    fireEvent.click(checkboxFor("Black Friday"));
    expect(lastConfig(onUpdate).pipeline_ids).toEqual([BLACK_FRIDAY]);
  });

  it("marcar um segundo funil acumula (semântica OR)", () => {
    const { onUpdate } = renderPanel({ pipeline_ids: [QUALIFICACAO] });
    fireEvent.click(checkboxFor("Propostas"));
    expect(lastConfig(onUpdate).pipeline_ids).toEqual([QUALIFICACAO, PROPOSTAS]);
  });

  it("desmarcar remove só aquele funil", () => {
    const { onUpdate } = renderPanel({ pipeline_ids: [QUALIFICACAO, PROPOSTAS] });
    fireEvent.click(checkboxFor("Qualificação"));
    expect(lastConfig(onUpdate).pipeline_ids).toEqual([PROPOSTAS]);
  });

  it("preserva os outros campos do config ao mexer nos funis", () => {
    const { onUpdate } = renderPanel({ channel: "whatsapp", contains_text: "sim" });
    fireEvent.click(checkboxFor("Propostas"));
    const cfg = lastConfig(onUpdate);
    expect(cfg.channel).toBe("whatsapp");
    expect(cfg.contains_text).toBe("sim");
    expect(cfg.pipeline_ids).toEqual([PROPOSTAS]);
  });

  it("esconde funil desativado que não está no filtro", () => {
    renderPanel();
    expect(screen.queryByText("Funil Antigo")).not.toBeInTheDocument();
  });

  // Senão o usuário veria "nenhum funil marcado" numa automação que na verdade
  // está restrita — e não teria como desmarcar.
  it("mostra funil desativado quando ele ainda está salvo no filtro", () => {
    renderPanel({ pipeline_ids: [ARQUIVADO] });
    expect(screen.getByText("Funil Antigo")).toBeInTheDocument();
    expect(screen.getByText("(desativado)")).toBeInTheDocument();
  });

  it("conta os funis selecionados", () => {
    renderPanel({ pipeline_ids: [QUALIFICACAO, PROPOSTAS] });
    expect(screen.getByText("2 funil(is) selecionado(s)")).toBeInTheDocument();
  });

  it("sem funis na org, avisa em vez de mostrar caixa vazia", () => {
    mockPipelines.mockReturnValue({ data: [] });
    renderPanel();
    expect(screen.getByText("Nenhum funil encontrado.")).toBeInTheDocument();
  });

  it("aguenta usePipelines ainda carregando (data undefined)", () => {
    mockPipelines.mockReturnValue({ data: undefined });
    expect(() => renderPanel()).not.toThrow();
    expect(screen.getByText("Nenhum funil encontrado.")).toBeInTheDocument();
  });

  it("contém texto continua editável ao lado do filtro por funil", () => {
    const { onUpdate } = renderPanel({ pipeline_ids: [QUALIFICACAO] });
    fireEvent.change(screen.getByPlaceholderText("Ex: confirmo, sim"), {
      target: { value: "orçamento" },
    });
    const cfg = lastConfig(onUpdate);
    expect(cfg.contains_text).toBe("orçamento");
    expect(cfg.pipeline_ids).toEqual([QUALIFICACAO]);
  });
});
