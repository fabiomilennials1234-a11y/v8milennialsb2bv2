/**
 * Tela do funil **Confirmação** — o "compareceu" MOVE o negócio para Orçamentos.
 *
 * É o maior dos três caminhos religados ao `mover_negocio`: a transição
 * confirmação → propostas está configurada em **95 organizações** (commit
 * 6f81a443). Antes daqui saíam DUAS escritas — o UPDATE da origem para
 * "compareceu" e um `createPipeProposta` que INSERIA um card novo em Orçamentos.
 * A origem nunca saía, e o mesmo negócio passava a existir em dois funis: é esse
 * gêmeo que faz **801 leads em prod** (medido 2026-08-03) aparecerem em mais de
 * um funil de sistema ao mesmo tempo.
 *
 * O helper tem suíte própria (`tests/unit/mover-negocio.test.ts`). O que faltava
 * prova é o RELIGAMENTO DA TELA, e são quatro coisas que só quebram em produção:
 *
 *  1. **Nenhum INSERT sobrou.** O `useCreatePipeProposta` saiu do arquivo. O
 *     teste prova a ausência: se alguém reintroduzir o hook, ele passa a ser
 *     chamado no render e o caso reprova.
 *  2. **A ordem das duas escritas.** `updatePipeConfirmacao` primeiro — é a
 *     TRANSIÇÃO para a etapa de sucesso que dispara `meeting_held`, não a
 *     permanência. Mover antes pularia o gatilho e as orgs parariam de contar
 *     reunião realizada no dia do deploy, sem erro nenhum em tela.
 *  3. **`stageOrigem: null`** — só é correto porque o passo 1 já fez esse
 *     UPDATE. Repetir a etapa aqui seria um UPDATE inerte.
 *  4. **A etapa de destino vem de `pipeline_stages`**, não chumbada no código.
 *     Três dos cinco caminhos de transição do produto chumbavam a etapa e por
 *     isso divergiam entre si; esta tela é a que lê a configuração.
 *
 * A tela tem ~1.100 linhas e ~45 imports, então tudo o que não é a decisão sob
 * prova está stubado. As duas costuras usadas são as mesmas do usuário real: o
 * `onStatusChange` do board (arrastar o card para a coluna de sucesso) e o
 * `onConfirm` do CompareceuModal (escolher o responsável e confirmar).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

// ── Estado de fixture, lido pelos mocks de hook ──────────────────────────────
let etapasDoFunil: Array<Record<string, unknown>> = [];
let idDoFunilPropostas: string | null = "pipe-propostas";

const cardEmConfirmacao = {
  id: "conf-1",
  lead_id: "lead-1",
  status: "confirmar_d1",
  sdr_id: "tm-1",
  closer_id: null,
  responsible_id: null,
  // Sem data de reunião de propósito: a tela roda um efeito que RECALCULA a
  // etapa a partir da data (D-5/D-3/D-1) e dispara um UPDATE próprio. Ele não é
  // o que está sob prova aqui, e ligá-lo poluiria a contagem de escritas.
  meeting_date: null,
  lead: { id: "lead-1", name: "Ana" },
};

// ── Espiões do que está sob prova ────────────────────────────────────────────
const moverNegocio = vi.fn().mockResolvedValue(undefined);
const invalidateAfterMove = vi.fn();
const updateConfirmacaoAsync = vi.fn().mockResolvedValue(undefined);
const createConfirmacaoAsync = vi.fn().mockResolvedValue({ id: "novo" });
const track = vi.fn();
/**
 * O INSERT que produzia o gêmeo. Espiona o HOOK, não a mutation: depois do
 * religamento a tela nem importa mais este módulo, então o hook não deve sequer
 * ser invocado durante o render.
 */
const useCreatePipePropostaSpy = vi.fn(() => ({
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/modules/pipelines/lib/moverNegocio", () => ({
  moverNegocio: (...a: unknown[]) => moverNegocio(...a),
  invalidateAfterMove: (...a: unknown[]) => invalidateAfterMove(...a),
}));

vi.mock("@/modules/pipelines/hooks/legacy/usePipePropostas", () => ({
  useCreatePipeProposta: () => useCreatePipePropostaSpy(),
  usePipePropostas: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/modules/pipelines/hooks/legacy/usePipeConfirmacao", () => ({
  usePipeConfirmacao: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useUpdatePipeConfirmacao: () => ({ mutateAsync: updateConfirmacaoAsync, isPending: false }),
  useCreatePipeConfirmacao: () => ({ mutateAsync: createConfirmacaoAsync, isPending: false }),
  useDeletePipeConfirmacao: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/modules/pipelines/hooks/model/usePipelineStages", () => ({
  usePipelineStages: () => ({ data: etapasDoFunil, isLoading: false }),
  stagesToColumns: (stages: Array<{ stage_key: string; name?: string }>) =>
    stages.map((s) => ({ id: s.stage_key, title: s.name ?? s.stage_key, color: "#fff" })),
  getPipelineTypeName: (t: string) => t,
}));

vi.mock("@/modules/pipelines/hooks/model/usePipelineEntries", () => ({
  usePipelineId: () => ({ data: idDoFunilPropostas, isLoading: false }),
}));

vi.mock("@/modules/pipelines/hooks/model/usePaginatedPipeline", () => ({
  usePaginatedPipeline: () => ({
    stageData: {},
    allItems: [cardEmConfirmacao],
    isLoading: false,
  }),
}));

vi.mock("@/modules/pipelines/lib/stageTransition", () => ({
  upsertLeadIntoCustomPipe: vi.fn().mockResolvedValue(undefined),
}));

// ── Costura 1: o board. Um botão no lugar do drag-and-drop. ──────────────────
vi.mock("@/modules/pipelines/components/kanban/DraggableKanbanBoard", () => ({
  DraggableKanbanBoard: ({
    onStatusChange,
  }: {
    onStatusChange: (id: string, status: string) => void;
  }) => (
    <button type="button" onClick={() => onStatusChange("conf-1", "compareceu")}>
      stub-arrastar-para-compareceu
    </button>
  ),
  DraggableItem: {},
  KanbanColumn: {},
}));

// ── Costura 2: o modal de comparecimento. ────────────────────────────────────
vi.mock("@/modules/leads", () => ({
  CompareceuModal: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: (id: string | null) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onConfirm("tm-9")}>
        stub-confirmar-comparecimento
      </button>
    ) : null,
  LeadModal: () => null,
  LeadCard: () => null,
  DealDetailDialog: () => null,
  // A página monta os dois painéis do Card e os importa do barrel; sem estas
  // chaves o mock devolve `undefined` e o React derruba a montagem antes de
  // qualquer asserção sobre o move. `LeadPanelProvider` entra pelo mesmo
  // motivo — vem no mesmo import de `@/modules/leads` que os painéis.
  DealCardPanel: () => null,
  LeadCardPanel: () => null,
  LeadPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DealPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDealSheet: () => ({ openDeal: vi.fn(), closeDeal: vi.fn() }),
  useDeleteAllLeadsInPipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateLead: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({ useTags: () => ({ data: [] }) }));
vi.mock("@/modules/leads/components/bulk-actions/BulkActionBar", () => ({
  BulkActionBar: () => null,
}));

// ── Resto da árvore: inerte ──────────────────────────────────────────────────
vi.mock("@/modules/identity", () => ({
  useCanDo: () => ({ allowed: true, isLoading: false }),
  useResponsibleMembers: () => [{ id: "tm-9", name: "Bruno", role: "closer" }],
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1" }),
  useFeaturePermission: () => ({ allowed: true, isLoading: false }),
  useIdentity: () => ({ isAdmin: true, isMaster: false }),
  useConfirmacaoOverdueDays: () => 3,
}));
vi.mock("@/modules/workflows/hooks/useStageWorkflows", () => ({
  useStageWorkflowCounts: () => ({ data: {} }),
}));
vi.mock("@/modules/pipelines/components/kanban/StageWorkflowsBadgeWrapper", () => ({
  StageWorkflowsBadgeWrapper: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/KanbanFilterPanel", () => ({
  KanbanFilterPanel: () => null,
  FilterChips: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/ExportStageDialog", () => ({
  ExportStageDialog: () => null,
}));
vi.mock("@/modules/pipelines/components/shared/PipeSettingsDialog", () => ({
  PipeSettingsDialog: () => null,
}));
vi.mock("@/modules/pipelines/components/shared/FunnelControlBar", () => ({
  FunnelControlBar: () => null,
}));
vi.mock("@/modules/pipelines/components/shared/FunnelViewsMenu", () => ({
  FunnelViewsMenu: () => null,
}));
vi.mock("@/modules/pipelines/components/shared/AutoCreateLeadToggle", () => ({
  AutoCreateLeadToggle: () => null,
}));
vi.mock("@/modules/pipelines/components/shared/PipeConfirmacaoAnalytics", () => ({
  PipeConfirmacaoAnalytics: () => null,
}));
vi.mock("@/modules/pipelines/components/shared/GhostLeadsBanner", () => ({
  GhostLeadsBanner: () => null,
}));
vi.mock("@/modules/pipelines/components/legacy/confirmacao/AddMeetingModal", () => ({
  AddMeetingModal: () => null,
}));
vi.mock("@/modules/pipelines/components/legacy/confirmacao/RescheduleModal", () => ({
  RescheduleModal: () => null,
}));
vi.mock("@/modules/pipelines/components/legacy/confirmacao/MeetingTimeline", () => ({
  MeetingTimeline: () => null,
}));
vi.mock("@/modules/pipelines/components/disparo", () => ({
  DisparoWizard: () => null,
}));
vi.mock("@/modules/platform/components/layout/LeadPanelLayout", () => ({
  LeadPanelLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/modules/engagement/hooks/useAcoesDoDia", () => ({
  useCreateAcaoDoDia: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  track: (...a: unknown[]) => track(...a),
  trackModuleVisit: vi.fn(),
}));
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: () => false }),
}));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Navigate: () => null,
}));

import PipeConfirmacao from "@/modules/pipelines/pages/PipeConfirmacao";

function etapaDeSucesso(overrides: Record<string, unknown> = {}) {
  return {
    id: "stage-compareceu",
    stage_key: "compareceu",
    name: "Compareceu",
    position: 8,
    is_final_positive: true,
    target_stage_key: "marcar_compromisso",
    target_pipe_type: null,
    target_pipeline_id: null,
    target_stage_id: null,
    ...overrides,
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PipeConfirmacao />
    </QueryClientProvider>,
  );
  return qc;
}

/** Arrasta o card para "Compareceu" e confirma o responsável no modal. */
async function marcarComparecimento() {
  fireEvent.click(screen.getByRole("button", { name: /stub-arrastar-para-compareceu/i }));
  const confirmar = await screen.findByRole("button", {
    name: /stub-confirmar-comparecimento/i,
  });
  fireEvent.click(confirmar);
}

beforeEach(() => {
  vi.clearAllMocks();
  idDoFunilPropostas = "pipe-propostas";
  etapasDoFunil = [
    { id: "s1", stage_key: "confirmar_d1", name: "Confirmar D-1", position: 4, is_final_positive: false },
    etapaDeSucesso(),
  ];
  moverNegocio.mockResolvedValue(undefined);
  updateConfirmacaoAsync.mockResolvedValue(undefined);
});

describe("PipeConfirmação — 'compareceu' troca o funil da MESMA linha", () => {
  it("chama moverNegocio com a etapa configurada e NÃO cria card em Orçamentos", async () => {
    montar();
    await marcarComparecimento();

    await waitFor(() => expect(moverNegocio).toHaveBeenCalledTimes(1));
    expect(moverNegocio).toHaveBeenCalledWith({
      entryId: "conf-1",
      targetPipelineId: "pipe-propostas",
      targetStageKey: "marcar_compromisso",
      stageOrigem: null,
      assignedTo: "tm-9",
    });
    // O gêmeo de 801 leads nascia deste INSERT. O hook nem existe mais na tela.
    expect(useCreatePipePropostaSpy).not.toHaveBeenCalled();
    expect(createConfirmacaoAsync).not.toHaveBeenCalled();
  });

  it("leva o card à etapa de sucesso ANTES de mover — é a transição que emite meeting_held", async () => {
    montar();
    await marcarComparecimento();

    await waitFor(() => expect(moverNegocio).toHaveBeenCalled());
    expect(updateConfirmacaoAsync).toHaveBeenCalledTimes(1);
    expect(updateConfirmacaoAsync.mock.calls[0][0]).toMatchObject({
      id: "conf-1",
      status: "compareceu",
      sdr_id: "tm-9",
      leadId: "lead-1",
      assignedTo: "tm-9",
    });
    expect(updateConfirmacaoAsync.mock.invocationCallOrder[0]).toBeLessThan(
      moverNegocio.mock.invocationCallOrder[0],
    );
  });

  it("manda stageOrigem null — não repete o UPDATE que a própria tela acabou de fazer", async () => {
    montar();
    await marcarComparecimento();

    await waitFor(() => expect(moverNegocio).toHaveBeenCalled());
    const params = moverNegocio.mock.calls[0][0] as { stageOrigem?: unknown };
    expect(params).toHaveProperty("stageOrigem", null);
    expect(params.stageOrigem).not.toBeUndefined();
  });

  it("a etapa de destino vem de pipeline_stages, não chumbada no código", async () => {
    etapasDoFunil = [etapaDeSucesso({ target_stage_key: "proposta_em_elaboracao" })];
    montar();
    await marcarComparecimento();

    await waitFor(() => expect(moverNegocio).toHaveBeenCalled());
    expect((moverNegocio.mock.calls[0][0] as { targetStageKey: string }).targetStageKey).toBe(
      "proposta_em_elaboracao",
    );
  });

  it("org sem funil de Orçamentos: nada é escrito e o erro aparece na tela", async () => {
    idDoFunilPropostas = null;
    montar();
    await marcarComparecimento();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(moverNegocio).not.toHaveBeenCalled();
    // A guarda vem antes do UPDATE — nada de deixar o card em "compareceu"
    // apontando para um funil que não existe.
    expect(updateConfirmacaoAsync).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("recusa do banco no move NÃO vira mensagem de sucesso nem card_moved", async () => {
    moverNegocio.mockRejectedValue(new Error("destino em funil customizado não é suportado"));
    montar();
    await marcarComparecimento();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/funil customizado/i);
    expect(track).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "card_moved" }),
    );
    // Degrada para trás: o card ficou em "compareceu" na Confirmação, sem gêmeo.
    expect(updateConfirmacaoAsync).toHaveBeenCalledTimes(1);
    expect(invalidateAfterMove).not.toHaveBeenCalled();
  });

  it("depois de mover, recarrega os DOIS funis e emite card_moved com o destino", async () => {
    const qc = montar();
    await marcarComparecimento();

    await waitFor(() => expect(invalidateAfterMove).toHaveBeenCalled());
    expect(invalidateAfterMove).toHaveBeenCalledWith(qc, "lead-1");
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "card_moved",
        entityType: "pipe_confirmacao",
        entityId: "conf-1",
        metadata: expect.objectContaining({ moved_to_pipe: "propostas" }),
      }),
    );
    expect(toast.success).toHaveBeenCalled();
  });
});
