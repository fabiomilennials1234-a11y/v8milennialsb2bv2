import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { MeetingFieldBlock } from "../MeetingFieldBlock";
import { MockPipeOpsProvider } from "@/modules/leads/pipe-ops/testing";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => Promise.resolve({ error: null }),
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "test@test.com" },
    loading: false,
  }),
}));

vi.mock("@/modules/identity/permissions/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "admin", isLoading: false }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false }),
}));

vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({ isMaster: false }),
}));

vi.mock("@/modules/identity/permissions/hooks/useCanDo", () => ({
  useCanDo: () => ({ allowed: true, reason: "admin", isLoading: false }),
}));

vi.mock("@/modules/pipelines/hooks/model/usePipelineEntries", () => ({
  usePipelineEntries: () => ({ data: [], isLoading: false }),
  usePipelineId: () => ({ data: "pipeline-confirmacao-id" }),
  findOrCreatePipelineEntry: vi.fn().mockResolvedValue({ id: "entry-new" }),
}));

vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({
  triggerFollowUpAutomation: vi.fn(),
}));

// CompareceuModal foi movido para leads (inversão F7) — stub local.
//
// O stub expõe o `onConfirm` num botão porque é ELE que dispara a transição
// compareceu → Orçamentos, que virou um MOVE (ADR-0023 decisão 4). Sem essa
// porta, o único caminho de escrita do bloco fica fora do alcance do teste.
vi.mock("../../../leads/funnel-contexts/modals/CompareceuModal", () => ({
  CompareceuModal: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: (responsibleId: string | null) => void;
  }) =>
    open ? (
      <div data-testid="compareceu-modal-stub">
        <button type="button" onClick={() => onConfirm("tm-7")}>
          stub-confirmar-comparecimento
        </button>
      </div>
    ) : null,
}));

// Pós-inversão F7: useCreatePipeConfirmacao/useUpdatePipeConfirmacao/
// useCreatePipeProposta + RescheduleModal vêm do PipeOpsPort (context).
// RescheduleModal arrasta hooks de GoogleCalendar — stub via slot do port.
const pipeOpsPort = {
  // SCRUM-641: o CTA é batizado pelo nome que a ORG usa (useSystemPipes →
  // display_config). O teste declara os funis da org em vez de herdar o trio.
  useSystemPipes: () =>
    ({
      data: [
        { pipe_type: "confirmacao", display_name: "Agendamentos", is_visible: true, position: 2 },
        { pipe_type: "propostas", display_name: "Orçamentos", is_visible: true, position: 3 },
      ],
      isLoading: false,
      isPending: false,
    }) as never,
  useCreatePipeConfirmacao: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }) as never,
  useUpdatePipeConfirmacao: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }) as never,
  useCreatePipeProposta: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }) as never,
  RescheduleModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="reschedule-modal-stub" /> : null,
};

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MockPipeOpsProvider port={pipeOpsPort}>{ui}</MockPipeOpsProvider>
    </QueryClientProvider>,
  );
}

const baseProps = {
  leadId: "lead-1",
  organizationId: "org-1",
};

describe("MeetingFieldBlock", () => {
  describe("state: empty (lead has no pipe_confirmacao entry)", () => {
    it("renders 'Sem reunião marcada' message and Adicionar CTA", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={null} locked={false} />,
      );
      expect(screen.getByText(/sem reunião marcada/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /adicionar a agendamentos/i }),
      ).toBeInTheDocument();
    });
  });

  describe("state: editable (lead in pipe_confirmacao + permission ok)", () => {
    const meetingRow = {
      id: "conf-1",
      lead_id: "lead-1",
      status: "reuniao_marcada",
      meeting_date: "2026-05-25T14:00:00.000Z",
      notes: null,
      responsible_id: null,
      organization_id: "org-1",
      updated_at: "2026-05-19T10:00:00.000Z",
    };

    it("renders datetime input + status select + Salvar button when not locked", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={false} />,
      );
      // Save button visible
      expect(screen.getByRole("button", { name: /salvar reunião/i })).toBeInTheDocument();
      // Datetime input present (type=datetime-local)
      const inputs = screen.getAllByDisplayValue(/2026-05-25/);
      expect(inputs.length).toBeGreaterThan(0);
    });

    it("renders 'Remarcar' button to open RescheduleModal", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={false} />,
      );
      expect(screen.getByRole("button", { name: /remarcar/i })).toBeInTheDocument();
    });

    it("opens CompareceuModal when user changes status to 'compareceu' and clicks Salvar", async () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={false} />,
      );
      // Click Salvar after status switched would normally open modal.
      // We assert by simulating internal trigger: any "compareceu" save path
      // should surface the stubbed modal element. Implementation chooses how;
      // test ensures CompareceuModal is rendered as a child component (controlled).
      // Trigger via a button label "Marcar comparecimento" that the editable
      // state must render for fast access.
      const compareceuBtn = screen.queryByRole("button", { name: /marcar comparecimento/i });
      expect(compareceuBtn).toBeInTheDocument();
      fireEvent.click(compareceuBtn!);
      await waitFor(() => {
        expect(screen.getByTestId("compareceu-modal-stub")).toBeInTheDocument();
      });
    });
  });

  describe("state: locked (lead in pipe_confirmacao + no permission)", () => {
    const meetingRow = {
      id: "conf-1",
      lead_id: "lead-1",
      status: "reuniao_marcada",
      meeting_date: "2026-05-25T14:00:00.000Z",
      notes: null,
      responsible_id: null,
      organization_id: "org-1",
      updated_at: "2026-05-19T10:00:00.000Z",
    };

    it("does not render Salvar button when locked", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={true} />,
      );
      expect(screen.queryByRole("button", { name: /salvar reunião/i })).not.toBeInTheDocument();
    });

    it("shows lock indicator with tooltip text", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={true} />,
      );
      // Lock icon via data-testid or aria-label
      expect(screen.getByLabelText(/somente leitura/i)).toBeInTheDocument();
    });

    it("renders meeting date and status as read-only text", () => {
      renderWithQuery(
        <MeetingFieldBlock {...baseProps} pipeData={meetingRow} locked={true} />,
      );
      // Status label rendered as text (not select)
      expect(screen.getByText(/reunião marcada/i)).toBeInTheDocument();
    });
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * O "compareceu" pela porta do DRAWER — MOVE, não duplica (ADR-0023 decisão 4)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Este bloco é a terceira das três telas religadas ao `mover_negocio`
 * (commit feeb60b4). Até ele, o `onConfirm` do CompareceuModal fazia DUAS
 * escritas: o UPDATE da Confirmação para "compareceu" e um `createPipeProposta`
 * que INSERIA um card novo em Orçamentos. A origem nunca saía — é esse gêmeo
 * que faz **801 leads em prod** (medido 2026-08-03) aparecerem em dois funis de
 * sistema ao mesmo tempo.
 *
 * A suíte de `moverNegocio` (`tests/unit/mover-negocio.test.ts`) prova o helper.
 * O que NÃO estava provado, e é onde o defeito nasceu e pode renascer, é o
 * religamento da TELA: que ela chama o helper, com os parâmetros certos, na
 * ordem certa, e que não sobrou nenhum INSERT no caminho.
 *
 * Três coisas custam caro se regredirem aqui:
 *
 *  1. **A ordem.** `updatePipe` primeiro — é a TRANSIÇÃO para "compareceu" que
 *     dispara `meeting_held`, não a permanência. Mover antes pularia o gatilho e
 *     as orgs parariam de contar reunião no dia do deploy, sem erro em tela.
 *  2. **`stageOrigem: null`.** Só é correto porque o passo 1 já fez esse UPDATE.
 *     Passar a etapa de novo seria um UPDATE inerte; passar `undefined` mandaria
 *     `undefined` para o banco.
 *  3. **Falha do move não pode virar sucesso.** A função no banco RECUSA destino
 *     em funil customizado. Engolir a recusa faz a tela dizer que moveu enquanto
 *     o card continua onde estava.
 */
describe("MeetingFieldBlock — comparecimento MOVE o negócio para Orçamentos", () => {
  const cardEmConfirmacao = {
    id: "conf-1",
    lead_id: "lead-1",
    status: "reuniao_marcada",
    meeting_date: "2026-05-25T14:00:00.000Z",
    notes: null,
    responsible_id: null,
    organization_id: "org-1",
    updated_at: "2026-05-19T10:00:00.000Z",
  };

  /**
   * Port sob medida por caso. Não reusa o `pipeOpsPort` do topo do arquivo
   * porque cada teste precisa de espiões próprios (o de cima cria `vi.fn()`
   * novos a cada render, o que impede asserção depois do clique).
   */
  function montar(
    overrides: Record<string, unknown> = {},
    pipeData: Record<string, unknown> | null = cardEmConfirmacao,
  ) {
    const updateAsync = vi.fn().mockResolvedValue(undefined);
    const createPropostaAsync = vi.fn().mockResolvedValue(undefined);
    const moverNegocio = vi.fn().mockResolvedValue(undefined);
    const invalidateAfterMove = vi.fn();

    const port = {
      useCreatePipeConfirmacao: () =>
        ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }) as never,
      useUpdatePipeConfirmacao: () =>
        ({ mutateAsync: updateAsync, isPending: false }) as never,
      // Permanece no port para que o teste possa provar a AUSÊNCIA da chamada:
      // se alguém reintroduzir o INSERT, este espião acusa.
      useCreatePipeProposta: () =>
        ({ mutateAsync: createPropostaAsync, isPending: false }) as never,
      usePipelineId: () => ({ data: "pipe-orcamentos", isLoading: false }) as never,
      moverNegocio,
      invalidateAfterMove,
      RescheduleModal: () => null,
      ...overrides,
    };

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MockPipeOpsProvider port={port as never}>
          <MeetingFieldBlock
            {...baseProps}
            pipeData={pipeData as never}
            locked={false}
          />
        </MockPipeOpsProvider>
      </QueryClientProvider>,
    );

    return { updateAsync, createPropostaAsync, moverNegocio, invalidateAfterMove, qc };
  }

  async function confirmarComparecimento() {
    fireEvent.click(screen.getByRole("button", { name: /marcar comparecimento/i }));
    await waitFor(() => screen.getByTestId("compareceu-modal-stub"));
    fireEvent.click(screen.getByRole("button", { name: /stub-confirmar-comparecimento/i }));
  }

  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("move a MESMA linha para Orçamentos em vez de inserir um card novo", async () => {
    const { moverNegocio, createPropostaAsync } = montar();

    await confirmarComparecimento();

    await waitFor(() => expect(moverNegocio).toHaveBeenCalledTimes(1));
    expect(moverNegocio).toHaveBeenCalledWith({
      entryId: "conf-1",
      targetPipelineId: "pipe-orcamentos",
      targetStageKey: "marcar_compromisso",
      stageOrigem: null,
      assignedTo: "tm-7",
    });
    // O gêmeo de 801 leads em prod nascia daqui.
    expect(createPropostaAsync).not.toHaveBeenCalled();
  });

  it("leva o card a 'compareceu' ANTES de mover — é a transição que emite meeting_held", async () => {
    const { updateAsync, moverNegocio } = montar();

    await confirmarComparecimento();

    await waitFor(() => expect(moverNegocio).toHaveBeenCalled());
    expect(updateAsync).toHaveBeenCalledTimes(1);
    expect(updateAsync.mock.calls[0][0]).toMatchObject({
      id: "conf-1",
      status: "compareceu",
      responsible_id: "tm-7",
      assignedTo: "tm-7",
    });
    // Ordem, não coincidência: invertê-la pula o gatilho de métrica.
    expect(updateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      moverNegocio.mock.invocationCallOrder[0],
    );
  });

  it("manda stageOrigem null — a própria tela já fez o UPDATE da etapa de sucesso", async () => {
    const { moverNegocio } = montar();

    await confirmarComparecimento();

    await waitFor(() => expect(moverNegocio).toHaveBeenCalled());
    const params = moverNegocio.mock.calls[0][0] as { stageOrigem?: unknown };
    // `null` explícito, e não ausente: o helper distingue os dois.
    expect(params).toHaveProperty("stageOrigem", null);
    expect(params.stageOrigem).not.toBeUndefined();
  });

  it("sem funil de Orçamentos na org, NADA é escrito e o erro aparece na tela", async () => {
    const { moverNegocio, updateAsync } = montar({
      usePipelineId: () => ({ data: null, isLoading: false }) as never,
    });

    await confirmarComparecimento();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(moverNegocio).not.toHaveBeenCalled();
    // A guarda vem ANTES do UPDATE — nada de deixar o card em "compareceu"
    // num funil que não existe.
    expect(updateAsync).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/funil de destino não encontrado/i);
  });

  it("card de Confirmação sem id não é movido — id nulo viraria 'negócio não encontrado'", async () => {
    const { moverNegocio, updateAsync } = montar({}, { ...cardEmConfirmacao, id: null });

    await confirmarComparecimento();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(moverNegocio).not.toHaveBeenCalled();
    expect(updateAsync).not.toHaveBeenCalled();
  });

  it("recusa do banco no move NÃO vira mensagem de sucesso", async () => {
    const { invalidateAfterMove } = montar({
      moverNegocio: vi
        .fn()
        .mockRejectedValue(new Error("destino em funil customizado não é suportado")),
    });

    await confirmarComparecimento();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/funil customizado/i);
    // Sem move, nada de invalidar cache e fingir que o board mudou.
    expect(invalidateAfterMove).not.toHaveBeenCalled();
  });

  it("depois de mover, recarrega os DOIS funis e o que é do lead", async () => {
    const { invalidateAfterMove, qc } = montar();

    await confirmarComparecimento();

    await waitFor(() => expect(invalidateAfterMove).toHaveBeenCalled());
    expect(invalidateAfterMove).toHaveBeenCalledWith(qc, "lead-1");
    expect(toast.success).toHaveBeenCalled();
  });
});
