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

const mockStages = vi.fn(() => ({ data: [] as unknown[] }));
const mockInstances = vi.fn(() => ({ data: [] as unknown[] }));

vi.mock("@/modules/pipelines", () => ({
  // O painel lê por `useFunisDaOrg`, que devolve o funil com `label` — o nome
  // que a ORG usa. `usePipelines` fica mockado porque outros módulos
  // importados no topo ainda o consomem.
  useFunisDaOrg: () => mockPipelines(),
  usePipelines: () => mockPipelines(),
  useAllPipelineStages: () => mockStages(),
  useCustomPipelines: () => ({ data: [] }),
  useCustomPipelineStages: () => ({ data: [] }),
  usePipelineStages: () => ({ data: [] }),
  usePipelineDisplayConfig: () => ({ data: [] }),
  useEtapasDoFunil: () => ({ data: [] }),
  getPipelineTypeName: (t: string) => t,
}));

vi.mock("@/modules/communication", () => ({
  useWhatsAppInstances: () => mockInstances(),
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

// A categoria "Negócios" do picker é gateada pela feature `deals` da org
// (o painel chama `useOrgFeatures`). Ligada por padrão; um teste abaixo desliga.
const mockHasFeature = vi.fn((key: string) => key === "deals");

vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: mockHasFeature }),
}));

import { TriggerPanel } from "./TriggerPanel";
import type { TriggerNodeData } from "@/types/workflow";

// ── Fixtures ─────────────────────────────────────────────

const QUALIFICACAO = "11111111-1111-1111-1111-111111111111";
const PROPOSTAS = "22222222-2222-2222-2222-222222222222";
const BLACK_FRIDAY = "33333333-3333-3333-3333-333333333333";
const ARQUIVADO = "44444444-4444-4444-4444-444444444444";

// `name` é o SEED congelado de `create_default_pipelines()`; `label` é como a
// org chama o funil (display_config). São diferentes de propósito nos dois de
// sistema: é isso que prova que a tela mostra o nome da org, e não o do seed.
const PIPELINES = [
  { id: QUALIFICACAO, name: "Qualificação", label: "Oportunidades", type: "system", is_active: true },
  { id: PROPOSTAS, name: "Propostas", label: "Orçamentos", type: "system", is_active: true },
  { id: BLACK_FRIDAY, name: "Black Friday", label: "Black Friday", type: "custom", is_active: true },
  { id: ARQUIVADO, name: "Funil Antigo", label: "Funil Antigo", type: "custom", is_active: false },
];

const ETAPA_ENVIADA = "55555555-5555-5555-5555-555555555555";
const ETAPA_NEGOCIACAO = "66666666-6666-6666-6666-666666666666";
const ETAPA_DE_OUTRO_FUNIL = "77777777-7777-7777-7777-777777777777";

const ETAPAS = [
  { id: ETAPA_ENVIADA, name: "Proposta Enviada", pipeline_id: PROPOSTAS, is_active: true },
  { id: ETAPA_NEGOCIACAO, name: "Em Negociação", pipeline_id: PROPOSTAS, is_active: true },
  { id: ETAPA_DE_OUTRO_FUNIL, name: "Sondagem", pipeline_id: QUALIFICACAO, is_active: true },
];

const DOIS_NUMEROS = [
  { id: "inst-closer", instance_name: "Comercial" },
  { id: "inst-sdr", instance_name: "Suporte" },
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
    mockStages.mockReturnValue({ data: ETAPAS });
    mockInstances.mockReturnValue({ data: [] });
    mockHasFeature.mockImplementation((key: string) => key === "deals");
  });

  it("mostra os três campos do trigger", () => {
    renderPanel();
    expect(screen.getByText("Canal")).toBeInTheDocument();
    expect(screen.getByText("Funis (opcional)")).toBeInTheDocument();
    expect(screen.getByText("Contém texto (opcional)")).toBeInTheDocument();
  });

  it("lista todos os funis juntos, sem separar por espécie", () => {
    renderPanel();
    // Um funil da org e um criado pelo usuário, lado a lado…
    expect(screen.getByText("Oportunidades")).toBeInTheDocument();
    // O seed NÃO aparece — era ele que a tela mostrava antes.
    expect(screen.queryByText("Qualificação")).not.toBeInTheDocument();
    expect(screen.getByText("Black Friday")).toBeInTheDocument();
    // …e nenhum cabeçalho dizendo a qual grupo cada um pertence.
    expect(screen.queryByText("Funis Padrão")).not.toBeInTheDocument();
    expect(screen.queryByText("Funis Custom")).not.toBeInTheDocument();
  });

  it("marcar um funil grava o uuid em pipeline_ids", () => {
    const { onUpdate } = renderPanel();
    fireEvent.click(checkboxFor("Black Friday"));
    expect(lastConfig(onUpdate).pipeline_ids).toEqual([BLACK_FRIDAY]);
  });

  it("marcar um segundo funil acumula (semântica OR)", () => {
    const { onUpdate } = renderPanel({ pipeline_ids: [QUALIFICACAO] });
    fireEvent.click(checkboxFor("Orçamentos"));
    expect(lastConfig(onUpdate).pipeline_ids).toEqual([QUALIFICACAO, PROPOSTAS]);
  });

  it("desmarcar remove só aquele funil", () => {
    const { onUpdate } = renderPanel({ pipeline_ids: [QUALIFICACAO, PROPOSTAS] });
    fireEvent.click(checkboxFor("Oportunidades"));
    expect(lastConfig(onUpdate).pipeline_ids).toEqual([PROPOSTAS]);
  });

  it("preserva os outros campos do config ao mexer nos funis", () => {
    const { onUpdate } = renderPanel({ channel: "whatsapp", contains_text: "sim" });
    fireEvent.click(checkboxFor("Orçamentos"));
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
  // ── Gate da categoria "Negócios" (feature `deals` da org) ──────────────
  // O painel filtra TRIGGER_CATEGORIES por `hasFeature("deals")`. Abrir o
  // Select do Radix em jsdom exige os dublês de ponteiro abaixo — jsdom não
  // implementa Pointer Events nem scrollIntoView, e o Radix chama os dois.

  function openTriggerTypeSelect() {
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.hasPointerCapture = () => false;
    proto.setPointerCapture = () => {};
    proto.releasePointerCapture = () => {};
    proto.scrollIntoView = () => {};
    const combobox = screen
      .getByText("Tipo de Trigger")
      .parentElement!.querySelector("[role='combobox']")!;
    // Radix abre pelo teclado sem depender de Pointer Events, que jsdom não tem.
    fireEvent.keyDown(combobox, { key: "Enter" });
  }

  it("org com a feature deals vê a categoria Negócios no picker", () => {
    renderPanel();
    openTriggerTypeSelect();
    expect(screen.getByText("Negócios")).toBeInTheDocument();
  });

  it("org sem a feature deals não vê a categoria Negócios no picker", () => {
    mockHasFeature.mockImplementation(() => false);
    renderPanel();
    openTriggerTypeSelect();
    expect(screen.queryByText("Negócios")).not.toBeInTheDocument();
  });
});

// ── Etapa, número de origem, modo e freio (2026-09-03) ───
//
// O que estes testes travam é a DIVULGAÇÃO PROGRESSIVA: nada aparece antes de
// fazer sentido. Não é enfeite — 43 das 62 orgs com chip têm um número só, e
// oferecer a elas uma escolha entre números que não existem é pior que não
// oferecer nada.

describe("TriggerPanel — lead_replied — etapa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipelines.mockReturnValue({ data: PIPELINES });
    mockStages.mockReturnValue({ data: ETAPAS });
    mockInstances.mockReturnValue({ data: [] });
    mockHasFeature.mockImplementation((key: string) => key === "deals");
  });

  it("não mostra etapas antes de um funil marcado", () => {
    renderPanel();
    expect(screen.queryByText("Etapas (opcional)")).not.toBeInTheDocument();
    expect(screen.queryByText("Proposta Enviada")).not.toBeInTheDocument();
  });

  it("mostra só as etapas dos funis marcados", () => {
    renderPanel({ pipeline_ids: [PROPOSTAS] });
    expect(screen.getByText("Proposta Enviada")).toBeInTheDocument();
    expect(screen.getByText("Em Negociação")).toBeInTheDocument();
    expect(screen.queryByText("Sondagem")).not.toBeInTheDocument();
  });

  it("marcar uma etapa grava o uuid em stage_ids", () => {
    const { onUpdate } = renderPanel({ pipeline_ids: [PROPOSTAS] });
    fireEvent.click(checkboxFor("Proposta Enviada"));
    expect(lastConfig(onUpdate).stage_ids).toEqual([ETAPA_ENVIADA]);
  });

  it("marcar uma segunda etapa acumula (semântica OR)", () => {
    const { onUpdate } = renderPanel({
      pipeline_ids: [PROPOSTAS],
      stage_ids: [ETAPA_ENVIADA],
    });
    fireEvent.click(checkboxFor("Em Negociação"));
    expect(lastConfig(onUpdate).stage_ids).toEqual([ETAPA_ENVIADA, ETAPA_NEGOCIACAO]);
  });

  // Sem isto o filtro ficaria restrito a uma etapa que sumiu da tela:
  // invisível e indesmarcável.
  it("desmarcar o funil leva junto as etapas dele", () => {
    const { onUpdate } = renderPanel({
      pipeline_ids: [PROPOSTAS],
      stage_ids: [ETAPA_ENVIADA, ETAPA_NEGOCIACAO],
    });
    // A tela mostra o `label` — o nome que a ORG usa (#1992) —, não o `name`
    // do seed. Clicar por "Propostas" achava nada desde que o painel passou a
    // ler `useFunisDaOrg`.
    fireEvent.click(checkboxFor("Orçamentos"));
    const cfg = lastConfig(onUpdate);
    expect(cfg.pipeline_ids).toEqual([]);
    expect(cfg.stage_ids).toEqual([]);
  });

  it("desmarcar um funil preserva as etapas do outro que segue marcado", () => {
    const { onUpdate } = renderPanel({
      pipeline_ids: [PROPOSTAS, QUALIFICACAO],
      stage_ids: [ETAPA_ENVIADA, ETAPA_DE_OUTRO_FUNIL],
    });
    fireEvent.click(checkboxFor("Oportunidades"));
    const cfg = lastConfig(onUpdate);
    expect(cfg.pipeline_ids).toEqual([PROPOSTAS]);
    expect(cfg.stage_ids).toEqual([ETAPA_ENVIADA]);
  });
});

describe("TriggerPanel — lead_replied — número de origem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipelines.mockReturnValue({ data: PIPELINES });
    mockStages.mockReturnValue({ data: ETAPAS });
    mockHasFeature.mockImplementation((key: string) => key === "deals");
  });

  it("não oferece escolha de número quando a org tem um só", () => {
    mockInstances.mockReturnValue({ data: [DOIS_NUMEROS[0]] });
    renderPanel();
    expect(screen.queryByText("De onde")).not.toBeInTheDocument();
  });

  it("não oferece escolha quando a org não tem número nenhum", () => {
    mockInstances.mockReturnValue({ data: [] });
    renderPanel();
    expect(screen.queryByText("De onde")).not.toBeInTheDocument();
  });

  it("oferece a escolha quando há dois números", () => {
    mockInstances.mockReturnValue({ data: DOIS_NUMEROS });
    renderPanel();
    expect(screen.getByText("De onde")).toBeInTheDocument();
    expect(screen.getByText("Comercial")).toBeInTheDocument();
    expect(screen.getByText("Suporte")).toBeInTheDocument();
  });

  it("marcar um número grava o id e declara o tipo de origem", () => {
    mockInstances.mockReturnValue({ data: DOIS_NUMEROS });
    const { onUpdate } = renderPanel();
    fireEvent.click(checkboxFor("Comercial"));
    const cfg = lastConfig(onUpdate);
    expect(cfg.source_ids).toEqual(["inst-closer"]);
    expect(cfg.source_type).toBe("whatsapp_instance");
  });
});

describe("TriggerPanel — lead_replied — modo e freio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipelines.mockReturnValue({ data: PIPELINES });
    mockStages.mockReturnValue({ data: ETAPAS });
    mockInstances.mockReturnValue({ data: [] });
    mockHasFeature.mockImplementation((key: string) => key === "deals");
  });

  it("a janela só existe no modo que a usa", () => {
    renderPanel({ reply_mode: "any" });
    expect(screen.queryByLabelText(/dentro de/i)).not.toBeInTheDocument();
  });

  it("after_outbound pede a janela, com 48h preenchidas", () => {
    renderPanel({ reply_mode: "after_outbound" });
    expect(screen.getByLabelText(/dentro de/i)).toHaveValue(48);
    expect(screen.queryByLabelText(/conversa nova após/i)).not.toBeInTheDocument();
  });

  it("first_of_thread pede o silêncio, com 24h preenchidas", () => {
    renderPanel({ reply_mode: "first_of_thread" });
    expect(screen.getByLabelText(/conversa nova após/i)).toHaveValue(24);
    expect(screen.queryByLabelText(/dentro de/i)).not.toBeInTheDocument();
  });

  it("o freio está sempre visível, com 60 minutos como padrão", () => {
    renderPanel();
    expect(screen.getByLabelText(/não repetir por/i)).toHaveValue(60);
  });

  it("o freio respeita o valor já salvo", () => {
    renderPanel({ cooldown_minutes: 5 });
    expect(screen.getByLabelText(/não repetir por/i)).toHaveValue(5);
  });
});
