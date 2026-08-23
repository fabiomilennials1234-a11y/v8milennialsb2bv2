/**
 * Tela do funil **WhatsApp** — agendar reunião MOVE o negócio para a Confirmação.
 *
 * Caminho de **81 organizações**, e era o recorte mais torto dos três (commit
 * feeb60b4): quem criava o card de destino era o `AddMeetingModal`, ANTES de a
 * origem ser tocada, e esta página atualizava a origem depois, no `onSuccess`.
 * A origem ficava para trás — o mesmo negócio em dois funis, o gêmeo que faz 801
 * leads em prod aparecerem em mais de um funil de sistema (medido 2026-08-03).
 *
 * O religamento inverteu a responsabilidade, e é essa FIAÇÃO que esta suíte
 * protege — ela não vive dentro do helper, vive na página:
 *
 *   `moveFromEntryId={meetingModal.pipeId}` → o modal move a linha existente em
 *        vez de criar outra. Se este prop sumir, o modal volta a INSERIR e o
 *        gêmeo volta, sem erro nenhum em tela.
 *   `beforeSubmit={...}` → o UPDATE da origem para a etapa de sucesso passou a
 *        rodar ANTES da escrita no destino. É essa TRANSIÇÃO que emite
 *        `meeting_booked`; a permanência não emite nada. Se voltar para o
 *        `onSuccess`, o UPDATE acontece depois do move — o card já não está mais
 *        no funil WhatsApp, e a métrica de reunião marcada simplesmente para.
 *
 * O `onSuccess` que sobrou é só efeito de leitura (log, `card_moved`,
 * invalidação de cache). Um caso prova exatamente isso: ele NÃO pode mais
 * escrever no funil.
 *
 * A página tem ~1.050 linhas e ~45 imports; tudo que não é a decisão sob prova
 * está stubado. As costuras são as do usuário real: arrastar o card para a etapa
 * de sucesso, e o ciclo de vida do modal de reunião.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

let etapasDoFunil: Array<Record<string, unknown>> = [];

const cardNoWhatsapp = {
  id: "wa-1",
  lead_id: "lead-1",
  status: "respondeu",
  sdr_id: "tm-5",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-01T10:00:00.000Z",
  lead: { id: "lead-1", name: "Ana", closer: null },
};

const updateWhatsappAsync = vi.fn().mockResolvedValue(undefined);
const invalidateAfterMove = vi.fn();
const track = vi.fn();
/** Props com que a página monta o modal de reunião — o que está sob prova. */
let propsDoModalDeReuniao: Record<string, unknown> | null = null;

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/modules/pipelines/lib/moverNegocio", () => ({
  invalidateAfterMove: (...a: unknown[]) => invalidateAfterMove(...a),
  moverNegocio: vi.fn().mockResolvedValue(undefined),
}));

// ── Costura 1: o modal de reunião. Expõe os props e os dois callbacks. ───────
vi.mock("@/modules/pipelines/components/legacy/confirmacao/AddMeetingModal", () => ({
  AddMeetingModal: (props: Record<string, unknown>) => {
    propsDoModalDeReuniao = props;
    if (!props.open) return null;
    return (
      <div data-testid="modal-reuniao" data-move-from={String(props.moveFromEntryId ?? "")}>
        <button
          type="button"
          onClick={() => void (props.beforeSubmit as (() => Promise<void>) | undefined)?.()}
        >
          stub-before-submit
        </button>
        <button
          type="button"
          onClick={() => void (props.onSuccess as (() => Promise<void>) | undefined)?.()}
        >
          stub-on-success
        </button>
      </div>
    );
  },
}));

// ── Costura 2: o board. Um botão no lugar do drag-and-drop. ─────────────────
vi.mock("@/modules/pipelines/components/kanban/DraggableKanbanBoard", () => ({
  DraggableKanbanBoard: ({
    onStatusChange,
  }: {
    onStatusChange: (id: string, status: string) => void;
  }) => (
    <button type="button" onClick={() => onStatusChange("wa-1", "agendado")}>
      stub-arrastar-para-agendado
    </button>
  ),
  KanbanColumn: {},
}));

vi.mock("@/modules/pipelines/hooks/legacy/usePipeWhatsapp", () => ({
  useCreatePipeWhatsapp: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePipeWhatsapp: () => ({ mutateAsync: updateWhatsappAsync, isPending: false }),
  useDeletePipeWhatsapp: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/modules/pipelines/hooks/legacy/usePipePropostas", () => ({
  useCreatePipeProposta: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/modules/pipelines/hooks/model/usePipelineStages", () => ({
  usePipelineStages: () => ({ data: etapasDoFunil, isLoading: false }),
  stagesToColumns: (stages: Array<{ stage_key: string; name?: string }>) =>
    stages.map((s) => ({ id: s.stage_key, title: s.name ?? s.stage_key, color: "#fff" })),
  getPipelineTypeName: (t: string) => t,
}));

vi.mock("@/modules/pipelines/hooks/model/usePaginatedPipeline", () => ({
  usePaginatedPipeline: () => ({
    stageData: {},
    allItems: [cardNoWhatsapp],
    isLoading: false,
    organizationId: "org-1",
  }),
}));

vi.mock("@/modules/pipelines/lib/stageTransition", () => ({
  upsertLeadIntoCustomPipe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

// Os dois painéis entram AQUI, no mock do barrel, e não como mock do caminho
// profundo — a página os importa de `@/modules/leads`, que é o que a convenção
// do repo manda (cross-module sempre pelo barrel). Mockar
// `.../deal-card/DealCardPanel` não intercepta nada nesse caminho: o módulo que
// a página resolve é o barrel, e um barrel mockado sem a chave devolve
// `undefined`, que o React recusa como componente e derruba a montagem inteira.
vi.mock("@/modules/leads", () => ({
  LeadCard: () => null,
  LeadModal: () => null,
  DealCardPanel: () => null,
  LeadCardPanel: () => null,
  DealPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  LeadPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDealSheet: () => ({ openDeal: vi.fn(), closeDeal: vi.fn() }),
  useDeleteAllLeadsInPipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateLead: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useBatchedLeadMetrics: () => ({ data: {} }),
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({ useTags: () => ({ data: [] }) }));
vi.mock("@/modules/leads/components/bulk-actions/BulkActionBar", () => ({
  BulkActionBar: () => null,
}));
// (os mocks de caminho profundo dos dois painéis saíram daqui — subiram para o
// mock do barrel acima, que é por onde a página realmente os resolve)

vi.mock("@/modules/identity", () => ({
  useCanDo: () => ({ allowed: true, isLoading: false }),
  useResponsibleMembers: () => [{ id: "tm-5", name: "Bruno", role: "sdr" }],
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-5" }),
  useFeaturePermission: () => ({ allowed: true, isLoading: false }),
  useUserRole: () => ({ data: "admin", isLoading: false }),
  useIdentity: () => ({ isAdmin: true, isMaster: false }),
}));

vi.mock("@/modules/workflows/hooks/useStageWorkflows", () => ({
  useStageWorkflowCounts: () => ({ data: {} }),
}));
vi.mock("@/modules/pipelines/components/kanban/StageWorkflowsBadgeWrapper", () => ({
  StageWorkflowsBadgeWrapper: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/MergedFunnelCardActions", () => ({
  MergedFunnelCardActions: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/KanbanFilterPanel", () => ({
  KanbanFilterPanel: () => null,
  FilterChips: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/ExportStageDialog", () => ({
  ExportStageDialog: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/CreateOpportunityModal", () => ({
  CreateOpportunityModal: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/PipeTableView", () => ({
  PipeTableView: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/PipelineListView", () => ({
  PipelineListView: () => null,
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
vi.mock("@/modules/pipelines/components/shared/PipeWhatsappAnalytics", () => ({
  PipeWhatsappAnalytics: () => null,
}));
vi.mock("@/modules/pipelines/components/shared/GhostLeadsBanner", () => ({
  GhostLeadsBanner: () => null,
}));
vi.mock("@/modules/pipelines/components/disparo", () => ({ DisparoWizard: () => null }));
vi.mock("@/modules/platform/components/layout/LeadPanelLayout", () => ({
  LeadPanelLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/modules/platform", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@/modules/engagement/hooks/useAcoesDoDia", () => ({
  useCreateAcaoDoDia: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/shared/hooks/use-viewport", () => ({ useViewport: () => ({ isMobile: false }) }));
vi.mock("@/lib/analytics", () => ({
  track: (...a: unknown[]) => track(...a),
  trackModuleVisit: vi.fn(),
}));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Navigate: () => null,
}));

import PipeWhatsapp from "@/modules/pipelines/pages/PipeWhatsapp";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PipeWhatsapp />
    </QueryClientProvider>,
  );
  return qc;
}

async function arrastarParaAgendado() {
  fireEvent.click(screen.getByRole("button", { name: /stub-arrastar-para-agendado/i }));
  return screen.findByTestId("modal-reuniao");
}

beforeEach(() => {
  vi.clearAllMocks();
  propsDoModalDeReuniao = null;
  etapasDoFunil = [
    { id: "s1", stage_key: "respondeu", name: "Respondeu", position: 2, is_final_positive: false },
    {
      id: "s2",
      stage_key: "agendado",
      name: "Agendado",
      position: 3,
      is_final_positive: true,
      target_pipe_type: null,
      target_stage_key: null,
      target_pipeline_id: null,
      target_stage_id: null,
    },
  ];
  updateWhatsappAsync.mockResolvedValue(undefined);
});

describe("PipeWhatsapp — agendar reunião move o negócio, não duplica", () => {
  it("manda o modal MOVER a linha de origem (moveFromEntryId), em vez de criar card", async () => {
    montar();
    const modal = await arrastarParaAgendado();

    expect(modal.getAttribute("data-move-from")).toBe("wa-1");
    expect(propsDoModalDeReuniao).toMatchObject({
      prefilledLeadId: "lead-1",
      moveFromEntryId: "wa-1",
    });
    expect(typeof propsDoModalDeReuniao?.beforeSubmit).toBe("function");
  });

  it("abrir o modal ainda NÃO escreve — cancelar deixa o card onde estava", async () => {
    montar();
    await arrastarParaAgendado();

    expect(updateWhatsappAsync).not.toHaveBeenCalled();
    expect(invalidateAfterMove).not.toHaveBeenCalled();
  });

  it("beforeSubmit leva a origem à etapa de sucesso — o UPDATE que emite meeting_booked", async () => {
    montar();
    await arrastarParaAgendado();

    fireEvent.click(screen.getByRole("button", { name: /stub-before-submit/i }));

    await waitFor(() => expect(updateWhatsappAsync).toHaveBeenCalledTimes(1));
    expect(updateWhatsappAsync).toHaveBeenCalledWith({
      id: "wa-1",
      status: "agendado",
      leadId: "lead-1",
      sdrId: "tm-5",
    });
  });

  it("onSuccess NÃO escreve mais no funil — só recarrega e registra", async () => {
    const qc = montar();
    await arrastarParaAgendado();

    fireEvent.click(screen.getByRole("button", { name: /stub-on-success/i }));

    await waitFor(() => expect(invalidateAfterMove).toHaveBeenCalled());
    // O UPDATE mudou de lugar: se voltar para cá, roda DEPOIS do move e o
    // gatilho de `meeting_booked` não vê a transição.
    expect(updateWhatsappAsync).not.toHaveBeenCalled();
    expect(invalidateAfterMove).toHaveBeenCalledWith(qc, "lead-1");
    expect(toast.success).toHaveBeenCalled();
  });

  it("o card_moved do agendamento diz para qual funil o negócio foi", async () => {
    montar();
    await arrastarParaAgendado();

    fireEvent.click(screen.getByRole("button", { name: /stub-on-success/i }));

    await waitFor(() => expect(track).toHaveBeenCalled());
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "card_moved",
        entityType: "pipe_whatsapp",
        entityId: "wa-1",
        metadata: expect.objectContaining({
          from_stage: "respondeu",
          to_stage: "agendado",
          moved_to_pipe: "confirmacao",
        }),
      }),
    );
  });

  it("etapa de sucesso com destino em funil CUSTOMIZADO não passa pelo modal de reunião", async () => {
    etapasDoFunil = [
      { id: "s1", stage_key: "respondeu", name: "Respondeu", position: 2, is_final_positive: false },
      {
        id: "s2",
        stage_key: "agendado",
        name: "Agendado",
        position: 3,
        is_final_positive: true,
        target_pipeline_id: "custom-1",
        target_stage_id: "custom-stage-1",
      },
    ];
    montar();
    fireEvent.click(screen.getByRole("button", { name: /stub-arrastar-para-agendado/i }));

    // O destino custom é outro caminho (a função no banco recusa esse move);
    // abrir o modal de reunião aqui agendaria uma reunião que ninguém pediu.
    await waitFor(() => expect(updateWhatsappAsync).toHaveBeenCalled());
    expect(screen.queryByTestId("modal-reuniao")).not.toBeInTheDocument();
  });
});
