/**
 * SCRUM-636 (D3) · Editor ÚNICO de etapas — contrato na superfície.
 *
 * Prova:
 *  1. Remoção de etapa com cards: "mover os N cards para ___" é OBRIGATÓRIO —
 *     ação desabilitada sem destino; com destino, o delete unificado recebe
 *     {stageKey, migrateToStageKey, pipelineId}.
 *  2. Regra de disparo ativa apontando para a etapa: o diálogo BLOQUEIA e
 *     mostra o que aponta (guarda F0 promovida a UX) — sem botão destrutivo.
 *  3. Modo CUSTOM: criar etapa despacha para o trilho custom (pipeline_id),
 *     nunca para o de sistema.
 *  4. Modo CUSTOM com shape sem stage_role: salvar edição NÃO escreve
 *     stage_role (nunca rebaixar won/lost governado — ADR-0017 §1).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// ── Trilho de SISTEMA (usePipelineStages) ───────────────────────────────────
const deleteStageMutate = vi.fn().mockResolvedValue({
  cards_migrados: 0,
  automacoes_desativadas: 0,
});
const createSystemMutate = vi.fn().mockResolvedValue({});
const updateSystemMutate = vi.fn().mockResolvedValue({});
const reorderSystemMutate = vi.fn().mockResolvedValue(true);
let mockLeadCounts: Record<string, number> = {};

vi.mock("@/modules/pipelines/hooks/model/usePipelineStages", () => ({
  useCreatePipelineStage: () => ({ mutateAsync: createSystemMutate, isPending: false }),
  useUpdatePipelineStage: () => ({ mutateAsync: updateSystemMutate, isPending: false }),
  useDeletePipelineStage: () => ({ mutateAsync: deleteStageMutate, isPending: false }),
  usePipelineStageDeleteImpact: () => ({ data: null, isLoading: false, isError: false }),
  useReorderPipelineStages: () => ({ mutateAsync: reorderSystemMutate, isPending: false }),
  usePipelineStageLeadCounts: () => ({ data: mockLeadCounts }),
  getPipelineTypeName: (t: string) => t,
  getStageFamilyName: (t: string) => t,
}));

// ── Trilho CUSTOM (useCustomPipelines) ──────────────────────────────────────
const createCustomMutate = vi.fn().mockResolvedValue({});
const updateCustomMutate = vi.fn().mockResolvedValue({});
const reorderCustomMutate = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/pipelines/hooks/custom/useCustomPipelines", () => ({
  useCustomPipelines: () => ({ data: [] }),
  useCreateCustomPipelineStage: () => ({ mutateAsync: createCustomMutate, isPending: false }),
  useUpdateCustomPipelineStage: () => ({ mutateAsync: updateCustomMutate, isPending: false }),
  useReorderCustomPipelineStages: () => ({ mutateAsync: reorderCustomMutate, isPending: false }),
}));

// ── Regras de disparo (guarda F0 → UX) ──────────────────────────────────────
let mockDispatchRules: Array<{
  id: string;
  is_active: boolean;
  pipeline_stage_id: string | null;
  trigger_type: string;
}> = [];
// SCRUM-641: o editor resolve o nome do funil-alvo pelo display config da
// org; sem AuthProvider no teste, o hook real explode — dublê inerte.
vi.mock("@/modules/pipelines/hooks/config/usePipelineDisplayConfig", () => ({
  usePipelineDisplayConfig: () => ({ data: [] }),
}));

vi.mock("@/modules/pipelines/hooks/config/usePipeDispatchRules", () => ({
  usePipeDispatchRules: () => ({ data: mockDispatchRules }),
}));

vi.mock("@/modules/engagement/hooks/useChecklistTemplates", () => ({
  useChecklistTemplates: () => ({ data: [] }),
}));
vi.mock("@/modules/pipelines/components/shared/TransitionSelector", () => ({
  TransitionSelector: () => null,
}));

// Radix Select não opera em jsdom (pointer capture) — select nativo no lugar.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      data-testid="native-select"
      value={value ?? ""}
      onChange={(e) => onValueChange((e.target as HTMLSelectElement).value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

import { ManagePipelineStagesContent } from "@/modules/pipelines/components/shared/ManagePipelineStagesModal";

const systemStages = [
  {
    id: "s1",
    stage_key: "novo",
    name: "Novo Lead",
    color: "#3b82f6",
    is_final_positive: false,
    is_final_negative: false,
    stage_role: "open" as const,
    checklist_template_id: null,
  },
  {
    id: "s2",
    stage_key: "abordado",
    name: "Abordado",
    color: "#eab308",
    is_final_positive: false,
    is_final_negative: false,
    stage_role: "open" as const,
    checklist_template_id: null,
  },
];

// Shape do host custom ANTIGO: sem stage_role (o contrato ainda não declara).
const customStages = [
  {
    id: "c1",
    stage_key: "em_andamento",
    name: "Em andamento",
    color: "#eab308",
    is_final_positive: false,
    is_final_negative: false,
    checklist_template_id: null,
  },
];

function abrirDialogoDeRemocao(container: HTMLElement, index = 0) {
  const trashes = container.querySelectorAll("svg.lucide-trash2");
  fireEvent.click(trashes[index].closest("button")!);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLeadCounts = {};
  mockDispatchRules = [];
});

describe("Editor único — remoção de etapa com cards (D3)", () => {
  it("exige destino: ação desabilitada sem escolha; com destino, migra pelo id do funil", async () => {
    mockLeadCounts = { novo: 5 };
    const { container } = render(
      <ManagePipelineStagesContent
        pipelineType="whatsapp"
        pipelineId="pipe-sys-1"
        stages={systemStages}
      />,
    );

    abrirDialogoDeRemocao(container, 0);

    // Contagem visível + ação travada sem destino. (O texto vem quebrado em
    // nós — casa pelo textContent do parágrafo inteiro.)
    const aviso = await screen.findByText(/Esta etapa tem/);
    expect(aviso.textContent).toContain("5 cards");
    const acao = screen.getByText("Mover e remover").closest("button")!;
    expect(acao).toHaveProperty("disabled", true);
    expect(deleteStageMutate).not.toHaveBeenCalled();

    // Escolhe o destino no select (a etapa removida NÃO é opção).
    const selects = screen.getAllByTestId("native-select");
    const migrateSelect = selects[selects.length - 1];
    expect(migrateSelect.innerHTML).not.toContain(">Novo Lead<");
    fireEvent.change(migrateSelect, { target: { value: "s2" } });

    const acaoDepois = screen.getByText("Mover e remover").closest("button")!;
    expect(acaoDepois).toHaveProperty("disabled", false);
    fireEvent.click(acaoDepois);

    await waitFor(() => expect(deleteStageMutate).toHaveBeenCalledTimes(1));
    expect(deleteStageMutate).toHaveBeenCalledWith({
      id: "s1",
      pipeline_type: "whatsapp",
      pipelineId: "pipe-sys-1",
      destinationStageId: "s2",
    });
  });

  it("etapa vazia: remove direto, sem select de migração", async () => {
    const { container } = render(
      <ManagePipelineStagesContent pipelineType="whatsapp" stages={systemStages} />,
    );
    abrirDialogoDeRemocao(container, 1);

    const acao = await screen.findByText("Remover");
    fireEvent.click(acao.closest("button")!);
    await waitFor(() => expect(deleteStageMutate).toHaveBeenCalledTimes(1));
    expect(deleteStageMutate.mock.calls[0][0]).toMatchObject({
      id: "s2",
      destinationStageId: undefined,
    });
  });
});

describe("Editor único — bloqueio por regra de disparo (F0 → UX)", () => {
  it("mostra o que aponta e não oferece botão destrutivo", async () => {
    mockDispatchRules = [
      { id: "r1", is_active: true, pipeline_stage_id: "s1", trigger_type: "lead_moved_to_stage" },
      { id: "r2", is_active: false, pipeline_stage_id: "s1", trigger_type: "lead_moved_to_stage" },
      { id: "r3", is_active: true, pipeline_stage_id: "s2", trigger_type: "lead_moved_to_stage" },
    ];
    mockLeadCounts = { novo: 5 }; // mesmo com cards, a regra vence

    const { container } = render(
      <ManagePipelineStagesContent
        pipelineType="whatsapp"
        pipelineId="pipe-sys-1"
        stages={systemStages}
      />,
    );
    abrirDialogoDeRemocao(container, 0);

    // Só a regra ATIVA da etapa s1 conta (r2 inativa e r3 de outra etapa, não).
    expect(await screen.findByText(/1 regra de disparo automático ativa aponta/)).toBeTruthy();
    expect(screen.queryByText("Mover e remover")).toBeNull();
    expect(screen.queryByText("Remover")).toBeNull();
    expect(screen.getByText("Entendi")).toBeTruthy();
    expect(deleteStageMutate).not.toHaveBeenCalled();
  });
});

describe("Editor único — modo CUSTOM", () => {
  it("criar etapa despacha para o trilho custom com pipeline_id", async () => {
    render(
      <ManagePipelineStagesContent
        pipelineId="custom-pipe-42"
        pipelineSlug="pos-venda"
        stages={customStages}
      />,
    );

    fireEvent.click(screen.getByText("Adicionar Etapa"));
    fireEvent.change(screen.getByPlaceholderText("Nome da nova etapa"), {
      target: { value: "Concluído" },
    });
    fireEvent.click(screen.getByText("Criar Etapa"));

    await waitFor(() => expect(createCustomMutate).toHaveBeenCalledTimes(1));
    expect(createCustomMutate.mock.calls[0][0]).toMatchObject({
      pipeline_id: "custom-pipe-42",
      name: "Concluído",
      position: 1,
    });
    expect(createSystemMutate).not.toHaveBeenCalled();
  });

  it("salvar edição de etapa SEM stage_role no shape não escreve stage_role (ADR-0017 §1)", async () => {
    const { container } = render(
      <ManagePipelineStagesContent
        pipelineId="custom-pipe-42"
        pipelineSlug="pos-venda"
        stages={customStages}
      />,
    );

    // Entra em edição (lápis) e salva (check) sem tocar no papel.
    fireEvent.click(container.querySelector("svg.lucide-pencil")!.closest("button")!);
    fireEvent.change(screen.getByPlaceholderText("Nome da etapa"), {
      target: { value: "Em negociação" },
    });
    fireEvent.click(container.querySelector("svg.lucide-check")!.closest("button")!);

    await waitFor(() => expect(updateCustomMutate).toHaveBeenCalledTimes(1));
    const payload = updateCustomMutate.mock.calls[0][0];
    expect(payload).toMatchObject({ id: "c1", pipeline_id: "custom-pipe-42", name: "Em negociação" });
    expect("stage_role" in payload).toBe(false);
    expect(updateSystemMutate).not.toHaveBeenCalled();
  });
});
