/**
 * Fluxos ricos de move da página unificada — `useFunilMoveFlow` (SCRUM-637).
 *
 * Substitui as duas suítes de página (`pipe-whatsapp-agendar-move` e
 * `pipe-confirmacao-compareceu-move`): as páginas morreram no flip e a FIAÇÃO
 * que elas provavam migrou pro hook. O que está sob prova continua o mesmo —
 * e ganhou a generalização por `stage_role`:
 *
 *  1. **Agendar MOVE, não duplica** (ADR-0023 d4): etapa de sucesso com destino
 *     `confirmacao` abre o AddMeetingModal com `moveFromEntryId` e o UPDATE da
 *     origem roda no `beforeSubmit` (é a transição que emite `meeting_booked`);
 *     o `onSuccess` não escreve.
 *  2. **Compareceu MOVE para Orçamentos**: ordem updateEntry → moverNegocio,
 *     `stageOrigem: null`, etapa de destino vinda de `pipeline_stages`.
 *  3. **Perdido exige motivo** (SCRUM-369): o move NÃO acontece sem escolha; o
 *     motivo entra no metadata (id + rótulo snapshotado) ANTES do move.
 *  4. **Won por PAPEL** — o prêmio da fatia: funil CUSTOM com etapa
 *     `stage_role: "won"` ganha a guarda de valor (D1/SQL-I3) e o
 *     `sale_value` entra no metadata antes da transição.
 *  5. Destino em funil custom não abre modal de reunião.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { toast } from "sonner";

const moverAsync = vi.fn().mockResolvedValue(undefined);
const patchEntryMetadata = vi.fn().mockResolvedValue(undefined);
const updateConfirmacaoAsync = vi.fn().mockResolvedValue(undefined);
const moverNegocio = vi.fn().mockResolvedValue(undefined);
const invalidateAfterMove = vi.fn();
const upsertLeadIntoCustomPipe = vi.fn().mockResolvedValue(undefined);
const triggerFollowUpAutomation = vi.fn().mockResolvedValue(undefined);
const track = vi.fn();
const logAction = vi.fn();

let tinyConnected = false;
let propsDoModalDeReuniao: Record<string, unknown> | null = null;

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/modules/pipelines/hooks/model/usePaginatedFunil", () => ({
  useMoverCardNoFunil: () => ({ mutateAsync: moverAsync, isPending: false }),
}));
vi.mock("@/modules/pipelines/lib/entry-metadata", () => ({
  patchEntryMetadata: (...a: unknown[]) => patchEntryMetadata(...a),
}));
vi.mock("@/modules/pipelines/hooks/legacy/usePipeConfirmacao", () => ({
  useUpdatePipeConfirmacao: () => ({ mutateAsync: updateConfirmacaoAsync, isPending: false }),
}));
vi.mock("@/modules/pipelines/lib/moverNegocio", () => ({
  moverNegocio: (...a: unknown[]) => moverNegocio(...a),
  invalidateAfterMove: (...a: unknown[]) => invalidateAfterMove(...a),
}));
vi.mock("@/modules/pipelines/lib/stageTransition", () => ({
  upsertLeadIntoCustomPipe: (...a: unknown[]) => upsertLeadIntoCustomPipe(...a),
}));
vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({
  triggerFollowUpAutomation: (...a: unknown[]) => triggerFollowUpAutomation(...a),
}));
vi.mock("@/lib/analytics", () => ({
  track: (...a: unknown[]) => track(...a),
  trackModuleVisit: vi.fn(),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => logAction,
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
}));
vi.mock("@/modules/leads", () => ({
  CompareceuModal: (props: Record<string, unknown>) =>
    props.open ? (
      <button type="button" onClick={() => (props.onConfirm as (r: string | null) => void)("tm-9")}>
        stub-compareceu-confirmar
      </button>
    ) : null,
}));
vi.mock("@/modules/carteira/components/proposal/TinyErpConfirmOrderDialog", () => ({
  TinyErpConfirmOrderDialog: (props: Record<string, unknown>) =>
    props.open ? (
      <button type="button" onClick={() => (props.onSuccess as () => void)()}>
        stub-tiny-confirmar
      </button>
    ) : null,
}));
vi.mock("@/modules/carteira/components/proposal/CadastroExternoConfirmDialog", () => ({
  CadastroExternoConfirmDialog: () => null,
}));
vi.mock("@/modules/carteira/hooks/useTinyErp", () => ({
  useTinyErpStatus: () => ({ data: { connected: tinyConnected } }),
}));
vi.mock("@/modules/marketing/hooks/useCadastroExterno", () => ({
  useCadastroExternoEnabled: () => false,
}));
vi.mock("@/modules/pipelines/hooks/config/useLossReasons", () => ({
  useLossReasons: () => ({
    data: [
      { id: "lr-1", name: "Sem budget" },
      { id: "lr-2", name: "Outro" },
    ],
  }),
}));
vi.mock("@/modules/pipelines/components/shared/SaleValueRequiredModal", () => ({
  SaleValueRequiredModal: (props: Record<string, unknown>) =>
    props.open ? (
      <button type="button" onClick={() => (props.onConfirm as (v: number) => void)(1234)}>
        stub-valor-confirmar
      </button>
    ) : null,
}));
vi.mock("@/modules/pipelines/components/kanban/SetMeetingDateModal", () => ({
  SetMeetingDateModal: (props: Record<string, unknown>) =>
    props.open ? (
      <button type="button" onClick={() => (props.onSaved as () => void)()}>
        stub-data-salva
      </button>
    ) : null,
}));
vi.mock("@/modules/pipelines/components/legacy/confirmacao/RescheduleModal", () => ({
  RescheduleModal: (props: Record<string, unknown>) =>
    props.open ? <div data-testid="modal-reschedule" /> : null,
}));
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
          onClick={() => void (props.onSuccess as (() => void) | undefined)?.()}
        >
          stub-on-success
        </button>
      </div>
    );
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    }),
  },
}));

// ── Select do shadcn vira <button> por opção — Radix Select não roda em jsdom.
const SelectCtx = createContext<(v: string) => void>(() => {});
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: any) => (
    <SelectCtx.Provider value={onValueChange}>{children}</SelectCtx.Provider>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => {
    const onChange = useContext(SelectCtx);
    return (
      <button type="button" onClick={() => onChange(value)}>
        {children}
      </button>
    );
  },
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

import {
  useFunilMoveFlow,
  type FunilFlowEntry,
} from "@/modules/pipelines/components/funis/useFunilMoveFlow";
import type { CustomPipelineStage } from "@/contracts/pipe";
import type { Pipeline } from "@/modules/pipelines/hooks/model/usePipelines";

const stageBase = {
  organization_id: "org-1",
  color: "#fff",
  is_active: true,
  is_final_positive: false,
  is_final_negative: false,
  target_pipeline_id: null,
  target_stage_id: null,
  target_pipe_type: null,
  target_stage_key: null,
  checklist_template_id: null,
  created_at: "",
  updated_at: "",
};

function stage(partial: Partial<CustomPipelineStage> & { stage_key: string }): CustomPipelineStage {
  return {
    id: `id-${partial.stage_key}`,
    pipeline_id: "pl-1",
    name: partial.stage_key,
    position: 0,
    ...stageBase,
    ...partial,
  } as CustomPipelineStage;
}

function pipelineDe(type: "system" | "custom", slug: string): Pipeline {
  return {
    id: "pl-1",
    organization_id: "org-1",
    name: slug,
    slug,
    type,
    description: null,
    icon: "target",
    color: "#fff",
    display_order: 0,
    is_active: true,
    config: {},
    created_by: null,
    created_at: "",
    updated_at: "",
  };
}

const propostasPipeline: Pipeline = { ...pipelineDe("system", "propostas"), id: "pl-prop" };

function Harness({
  pipeline,
  stages,
  entries,
}: {
  pipeline: Pipeline;
  stages: CustomPipelineStage[];
  entries: FunilFlowEntry[];
}) {
  const flow = useFunilMoveFlow({
    pipeline,
    pipelines: [pipeline, propostasPipeline],
    stages,
    findEntry: (id) => entries.find((e) => e.id === id),
  });
  return (
    <>
      {stages.map((st) => (
        <button
          key={st.stage_key}
          type="button"
          onClick={() => flow.requestMove(entries[0].id, st)}
        >
          {`mover-${st.stage_key}`}
        </button>
      ))}
      {flow.dialogs}
    </>
  );
}

function montar(pipeline: Pipeline, stages: CustomPipelineStage[], entries: FunilFlowEntry[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Harness pipeline={pipeline} stages={stages} entries={entries} />
    </QueryClientProvider>,
  );
  return qc;
}

const entryBase: FunilFlowEntry = {
  id: "e-1",
  lead_id: "lead-1",
  stage_key: "novo",
  status: "novo",
  sdr_id: "tm-5",
  lead: { id: "lead-1", name: "Ana", company: "ACME", phone: "551199" },
};

beforeEach(() => {
  vi.clearAllMocks();
  tinyConnected = false;
  propsDoModalDeReuniao = null;
});

// ── 1. Agendar reunião (etapa de sucesso → confirmacao) ─────────────────────
describe("agendar reunião MOVE o negócio (ADR-0023 d4)", () => {
  const stagesWa = [
    stage({ stage_key: "respondeu" }),
    stage({
      stage_key: "agendado",
      stage_role: "meeting_booked",
      is_final_positive: true,
      target_pipe_type: "confirmacao",
    }),
  ];

  it("abre o modal mandando MOVER a linha de origem (moveFromEntryId)", async () => {
    montar(pipelineDe("system", "whatsapp"), stagesWa, [entryBase]);
    fireEvent.click(screen.getByRole("button", { name: "mover-agendado" }));

    const modal = await screen.findByTestId("modal-reuniao");
    expect(modal.getAttribute("data-move-from")).toBe("e-1");
    expect(propsDoModalDeReuniao).toMatchObject({
      prefilledLeadId: "lead-1",
      moveFromEntryId: "e-1",
    });
    // Abrir ainda não escreveu nada — cancelar deixa o card onde estava.
    expect(moverAsync).not.toHaveBeenCalled();
    expect(invalidateAfterMove).not.toHaveBeenCalled();
  });

  it("beforeSubmit leva a origem à etapa de sucesso — a transição que emite meeting_booked", async () => {
    montar(pipelineDe("system", "whatsapp"), stagesWa, [entryBase]);
    fireEvent.click(screen.getByRole("button", { name: "mover-agendado" }));
    await screen.findByTestId("modal-reuniao");

    fireEvent.click(screen.getByRole("button", { name: /stub-before-submit/i }));

    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    expect(moverAsync).toHaveBeenCalledWith({
      entryId: "e-1",
      stageId: "id-agendado",
      stageKey: "agendado",
    });
  });

  it("onSuccess NÃO escreve — só registra e recarrega, com moved_to_pipe no track", async () => {
    montar(pipelineDe("system", "whatsapp"), stagesWa, [entryBase]);
    fireEvent.click(screen.getByRole("button", { name: "mover-agendado" }));
    await screen.findByTestId("modal-reuniao");

    fireEvent.click(screen.getByRole("button", { name: /stub-on-success/i }));

    await waitFor(() => expect(invalidateAfterMove).toHaveBeenCalled());
    expect(moverAsync).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "card_moved",
        entityType: "pipe_whatsapp",
        entityId: "e-1",
        metadata: expect.objectContaining({
          from_stage: "novo",
          to_stage: "agendado",
          moved_to_pipe: "confirmacao",
        }),
      }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("destino em funil CUSTOMIZADO não passa pelo modal de reunião", async () => {
    const stagesCustomTarget = [
      stage({ stage_key: "respondeu" }),
      stage({
        stage_key: "agendado",
        stage_role: "meeting_booked",
        is_final_positive: true,
        target_pipeline_id: "custom-1",
        target_stage_id: "custom-stage-1",
      }),
    ];
    montar(pipelineDe("system", "whatsapp"), stagesCustomTarget, [entryBase]);
    fireEvent.click(screen.getByRole("button", { name: "mover-agendado" }));

    await waitFor(() => expect(moverAsync).toHaveBeenCalled());
    expect(screen.queryByTestId("modal-reuniao")).not.toBeInTheDocument();
    // Auto-transição pro funil de destino roda no pós-move.
    await waitFor(() => expect(upsertLeadIntoCustomPipe).toHaveBeenCalled());
  });
});

// ── 2. Compareceu → Orçamentos ──────────────────────────────────────────────
describe("compareceu MOVE o negócio para Orçamentos", () => {
  const stagesConf = [
    stage({ stage_key: "confirmacao_no_dia" }),
    stage({
      stage_key: "compareceu",
      stage_role: "meeting_held",
      is_final_positive: true,
      target_pipe_type: "propostas",
      target_stage_key: "reativar",
    }),
  ];
  const entryConf: FunilFlowEntry = { ...entryBase, stage_key: "confirmacao_no_dia", status: "confirmacao_no_dia" };

  it("ordem: updateEntry (produz meeting_held) ANTES do moverNegocio, com stageOrigem null", async () => {
    const ordem: string[] = [];
    updateConfirmacaoAsync.mockImplementation(async () => {
      ordem.push("update");
    });
    moverNegocio.mockImplementation(async () => {
      ordem.push("mover");
    });

    montar(pipelineDe("system", "confirmacao"), stagesConf, [entryConf]);
    fireEvent.click(screen.getByRole("button", { name: "mover-compareceu" }));
    fireEvent.click(await screen.findByRole("button", { name: /stub-compareceu-confirmar/i }));

    await waitFor(() => expect(moverNegocio).toHaveBeenCalledTimes(1));
    expect(ordem).toEqual(["update", "mover"]);
    expect(updateConfirmacaoAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e-1", status: "compareceu", sdr_id: "tm-9" }),
    );
    // Etapa de destino vem de pipeline_stages, não chumbada.
    expect(moverNegocio).toHaveBeenCalledWith({
      entryId: "e-1",
      targetPipelineId: "pl-prop",
      targetStageKey: "reativar",
      stageOrigem: null,
      assignedTo: "tm-9",
    });
    expect(invalidateAfterMove).toHaveBeenCalled();
  });

  it("nenhum INSERT de card novo — o caminho é o mover_negocio", async () => {
    montar(pipelineDe("system", "confirmacao"), stagesConf, [entryConf]);
    fireEvent.click(screen.getByRole("button", { name: "mover-compareceu" }));
    fireEvent.click(await screen.findByRole("button", { name: /stub-compareceu-confirmar/i }));

    await waitFor(() => expect(moverNegocio).toHaveBeenCalled());
    // O mover genérico do board não roda neste fluxo — a troca de funil é do
    // moverNegocio (uma linha só, nunca duas).
    expect(moverAsync).not.toHaveBeenCalled();
  });
});

// ── 3. Perdido exige motivo (SCRUM-369) ─────────────────────────────────────
describe("perdido exige motivo antes do move", () => {
  const stagesLost = [
    stage({ stage_key: "aberto" }),
    stage({ stage_key: "descartado", stage_role: "lost" }),
  ];

  it("sem escolher motivo, confirmar não move (botão travado por perdaResolvida)", async () => {
    montar(pipelineDe("custom", "meu-funil"), stagesLost, [entryBase]);
    fireEvent.click(screen.getByRole("button", { name: "mover-descartado" }));

    const confirmar = await screen.findByRole("button", { name: /confirmar perda/i });
    expect(confirmar).toBeDisabled();
    fireEvent.click(confirmar);
    expect(moverAsync).not.toHaveBeenCalled();
    expect(patchEntryMetadata).not.toHaveBeenCalled();
  });

  it("motivo escolhido: id + rótulo snapshotado entram no metadata ANTES do move", async () => {
    const ordem: string[] = [];
    patchEntryMetadata.mockImplementation(async () => {
      ordem.push("metadata");
    });
    moverAsync.mockImplementation(async () => {
      ordem.push("move");
    });

    montar(pipelineDe("custom", "meu-funil"), stagesLost, [entryBase]);
    fireEvent.click(screen.getByRole("button", { name: "mover-descartado" }));
    await screen.findByRole("button", { name: /confirmar perda/i });

    fireEvent.click(screen.getByRole("button", { name: "Sem budget" }));
    fireEvent.click(screen.getByRole("button", { name: /confirmar perda/i }));

    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    expect(ordem).toEqual(["metadata", "move"]);
    expect(patchEntryMetadata).toHaveBeenCalledWith("e-1", {
      loss_reason_id: "lr-1",
      loss_reason: "Sem budget",
    });
    expect(moverAsync).toHaveBeenCalledWith({
      entryId: "e-1",
      stageId: "id-descartado",
      stageKey: "descartado",
    });
  });
});

// ── 4. Won por papel — o prêmio: funil custom com etapa won ─────────────────
describe("won por stage_role — funil custom ganha o fluxo de vendido", () => {
  const stagesWon = [
    stage({ stage_key: "aberto" }),
    stage({ stage_key: "fechou", stage_role: "won" }),
  ];

  it("sem valor: a guarda abre, e o valor digitado entra no metadata ANTES do move", async () => {
    const ordem: string[] = [];
    patchEntryMetadata.mockImplementation(async () => {
      ordem.push("metadata");
    });
    moverAsync.mockImplementation(async () => {
      ordem.push("move");
    });

    montar(pipelineDe("custom", "meu-funil"), stagesWon, [entryBase]);
    fireEvent.click(screen.getByRole("button", { name: "mover-fechou" }));

    // Guarda de valor (D1/SQL-I3): nada escrito ainda.
    const confirmar = await screen.findByRole("button", { name: /stub-valor-confirmar/i });
    expect(moverAsync).not.toHaveBeenCalled();

    fireEvent.click(confirmar);

    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    expect(ordem).toEqual(["metadata", "move"]);
    expect(patchEntryMetadata).toHaveBeenCalledWith("e-1", { sale_value: 1234 });
  });

  it("com valor presente, move direto — sem modal", async () => {
    const entryComValor: FunilFlowEntry = { ...entryBase, sale_value: 900 };
    montar(pipelineDe("custom", "meu-funil"), stagesWon, [entryComValor]);
    fireEvent.click(screen.getByRole("button", { name: "mover-fechou" }));

    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /stub-valor-confirmar/i })).not.toBeInTheDocument();
    // Valor já estava no metadata — nenhum patch redundante.
    expect(patchEntryMetadata).not.toHaveBeenCalled();
  });

  it("TinyERP conectado: modal de pedido no drag-to-won — qualquer funil", async () => {
    tinyConnected = true;
    const entryComValor: FunilFlowEntry = { ...entryBase, sale_value: 900 };
    montar(pipelineDe("custom", "meu-funil"), stagesWon, [entryComValor]);
    fireEvent.click(screen.getByRole("button", { name: "mover-fechou" }));

    fireEvent.click(await screen.findByRole("button", { name: /stub-tiny-confirmar/i }));
    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
  });
});

// ── 5. meeting_booked genérico (sem trilho D-x) ─────────────────────────────
describe("meeting_booked genérico — data antes do move", () => {
  const stagesMeeting = [
    stage({ stage_key: "aberto" }),
    stage({ stage_key: "reuniao", stage_role: "meeting_booked" }),
  ];

  it("abre o modal de data; salvar completa o move na etapa arrastada", async () => {
    montar(pipelineDe("custom", "meu-funil"), stagesMeeting, [entryBase]);
    fireEvent.click(screen.getByRole("button", { name: "mover-reuniao" }));

    expect(moverAsync).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /stub-data-salva/i }));

    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    expect(moverAsync).toHaveBeenCalledWith({
      entryId: "e-1",
      stageId: "id-reuniao",
      stageKey: "reuniao",
    });
  });
});
