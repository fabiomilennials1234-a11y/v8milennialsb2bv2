/**
 * Régua de espera (CX ①) — o card do Funil muda de coluna ANTES da checagem
 * de tarefa (`requestTaskMove`, que vai ao servidor): < 100 ms entre soltar e
 * ver o card no lugar. Cancelar o modal de tarefa devolve o card; erro de
 * gravação reverte; nenhuma escrita acontece antes da confirmação.
 *
 * Prelúdio de dublês copiado de `funil-move-flow.test.tsx` (mesmo hook).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { toast } from "sonner";

let resolverTarefa: ((ok: boolean) => void) | null = null;
const requestTaskMove = vi.fn(
  () => new Promise<boolean>((r) => (resolverTarefa = r)),
);
vi.mock("@/modules/engagement/tasks", () => ({
  useTaskMoveGate: () => requestTaskMove,
}));

const moverAsync = vi.fn().mockResolvedValue(undefined);
const patchEntryMetadata = vi.fn().mockResolvedValue(undefined);
const updateConfirmacaoAsync = vi.fn().mockResolvedValue(undefined);
const moverNegocio = vi.fn().mockResolvedValue(undefined);
const invalidateAfterMove = vi.fn();
const reconciliarMoveNoFunil = vi.fn();
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
// Dublê por spread: otimismo/rollback são os REAIS (exercitados sobre o
// QueryClient do teste); só a reconciliação vira espiã.
vi.mock("@/modules/pipelines/lib/funil-move-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/pipelines/lib/funil-move-cache")>()),
  reconciliarMoveNoFunil: (...a: unknown[]) => reconciliarMoveNoFunil(...a),
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
// A porta do motivo é a REAL (diálogo + regra): só o resto do barril é dublê.
vi.mock("@/modules/leads", async () => ({
  useLossReasonGate: (await import("@/modules/leads/loss-reason-gate")).useLossReasonGate,
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
vi.mock("@/shared/components/SaleValueRequiredModal", () => ({
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

type MockProps = {
  children?: import("react").ReactNode;
  onValueChange?: (v: string) => void;
  value?: string;
  open?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

// ── Select do shadcn vira <button> por opção — Radix Select não roda em jsdom.
const SelectCtx = createContext<(v: string) => void>(() => {});
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: MockProps) => (
    <SelectCtx.Provider value={onValueChange}>{children}</SelectCtx.Provider>
  ),
  SelectTrigger: ({ children }: MockProps) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: MockProps) => <div>{children}</div>,
  SelectItem: ({ children, value }: MockProps) => {
    const onChange = useContext(SelectCtx);
    return (
      <button type="button" onClick={() => onChange(value)}>
        {children}
      </button>
    );
  },
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: MockProps) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: MockProps) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: MockProps) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: MockProps) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: MockProps) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: MockProps) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick, disabled }: MockProps) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children, onClick }: MockProps) => (
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
import { LossReasonGateProvider } from "@/modules/leads/loss-reason-gate";
import { MockPipeOpsProvider } from "@/modules/leads/pipe-ops/testing";

const CATALOGO_DE_MOTIVOS = [
  { id: "lr-1", name: "Sem budget", organization_id: "org-1" },
  { id: "lr-2", name: "Outro", organization_id: "org-1" },
];
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

/** A promessa do último `requestMove` — o drop do kanban não a espera. */
let ultimoMove: unknown = null;

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
          onClick={() => {
            ultimoMove = flow.requestMove(entries[0].id, st);
          }}
        >
          {`mover-${st.stage_key}`}
        </button>
      ))}
      {flow.dialogs}
    </>
  );
}

function montar(
  pipeline: Pipeline,
  stages: CustomPipelineStage[],
  entries: FunilFlowEntry[],
  { comPorta = true }: { comPorta?: boolean } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const harness = <Harness pipeline={pipeline} stages={stages} entries={entries} />;
  render(
    <QueryClientProvider client={qc}>
      <MockPipeOpsProvider port={{ useLossReasons: (() => ({ data: CATALOGO_DE_MOTIVOS })) as never }}>
        {comPorta ? <LossReasonGateProvider>{harness}</LossReasonGateProvider> : harness}
      </MockPipeOpsProvider>
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

// ── Cache semeado: duas colunas + contagem ─────────────────────────────────
const k = (s: string) => ["pipeline-page", "pl-1", s, "org-1", "f"];
const countsK = ["pipeline-stage-counts", "pl-1", "org-1", "{}"];
function semear(qc: QueryClient, de = "aberto", para = "proposta") {
  qc.setQueryData(k(de), { pages: [[{ id: "e-1", stage_key: de }]], pageParams: [null] });
  qc.setQueryData(k(para), { pages: [[]], pageParams: [null] });
  qc.setQueryData(countsK, { [de]: 1, [para]: 0 });
}
const ids = (qc: QueryClient, s: string) =>
  (qc.getQueryData(k(s)) as { pages: Array<Array<{ id: string }>> }).pages.flat().map((e) => e.id);
const entryAberto: FunilFlowEntry = { ...entryBase, stage_key: "aberto", status: "aberto" };

describe("move otimista antes da checagem de tarefa", () => {
  const stages = [
    stage({ stage_key: "aberto" }),
    stage({ stage_key: "proposta" }),
    stage({ stage_key: "descartado", stage_role: "lost" }),
    stage({ stage_key: "ganho", stage_role: "won" }),
  ];

  beforeEach(() => {
    resolverTarefa = null;
    requestTaskMove.mockClear();
  });

  it("card já está no destino enquanto a checagem de tarefa roda; nada gravado ainda", async () => {
    const qc = montar(pipelineDe("custom", "meu-funil"), stages, [entryAberto]);
    semear(qc);
    fireEvent.click(screen.getByRole("button", { name: "mover-proposta" }));
    await waitFor(() => expect(requestTaskMove).toHaveBeenCalledWith("e-1"));
    expect(ids(qc, "proposta")).toEqual(["e-1"]);
    expect(ids(qc, "aberto")).toEqual([]);
    expect(qc.getQueryData(countsK)).toEqual({ aberto: 0, proposta: 1 });
    expect(moverAsync).not.toHaveBeenCalled();
    expect(patchEntryMetadata).not.toHaveBeenCalled();

    resolverTarefa!(true);
    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    // O otimismo já aplicado viaja com o move: o mover não reaplica nem reverte.
    expect(moverAsync.mock.calls[0][0].otimistaDoChamador).toBeDefined();
    expect(ids(qc, "proposta")).toEqual(["e-1"]);
  });

  it("cancelar o modal de tarefa devolve o card à origem, sem gravar", async () => {
    const qc = montar(pipelineDe("custom", "meu-funil"), stages, [entryAberto]);
    semear(qc);
    fireEvent.click(screen.getByRole("button", { name: "mover-proposta" }));
    await waitFor(() => expect(requestTaskMove).toHaveBeenCalled());
    expect(ids(qc, "proposta")).toEqual(["e-1"]);

    resolverTarefa!(false);
    await waitFor(() => expect(ids(qc, "aberto")).toEqual(["e-1"]));
    expect(ids(qc, "proposta")).toEqual([]);
    expect(qc.getQueryData(countsK)).toEqual({ aberto: 1, proposta: 0 });
    expect(moverAsync).not.toHaveBeenCalled();
  });

  it("gravação recusada pelo servidor reverte o card", async () => {
    moverAsync.mockRejectedValueOnce(new Error("boom"));
    const qc = montar(pipelineDe("custom", "meu-funil"), stages, [entryAberto]);
    semear(qc);
    fireEvent.click(screen.getByRole("button", { name: "mover-proposta" }));
    await waitFor(() => expect(requestTaskMove).toHaveBeenCalled());
    resolverTarefa!(true);
    await waitFor(() => expect(moverAsync).toHaveBeenCalled());
    await waitFor(() => expect(ids(qc, "aberto")).toEqual(["e-1"]));
    expect(ids(qc, "proposta")).toEqual([]);
  });

  it("perda: card vai antes da tarefa; cancelar o motivo devolve", async () => {
    const qc = montar(pipelineDe("custom", "meu-funil"), stages, [entryAberto]);
    semear(qc, "aberto", "descartado");
    fireEvent.click(screen.getByRole("button", { name: "mover-descartado" }));
    await waitFor(() => expect(requestTaskMove).toHaveBeenCalled());
    expect(ids(qc, "descartado")).toEqual(["e-1"]);
    resolverTarefa!(true);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(ids(qc, "aberto")).toEqual(["e-1"]));
    expect(patchEntryMetadata).not.toHaveBeenCalled();
    expect(moverAsync).not.toHaveBeenCalled();
  });

  it("venda (guarda de valor com modal) não move antes da confirmação — sem piscar", async () => {
    const qc = montar(pipelineDe("custom", "meu-funil"), stages, [entryAberto]);
    semear(qc, "aberto", "ganho");
    fireEvent.click(screen.getByRole("button", { name: "mover-ganho" }));
    await waitFor(() => expect(requestTaskMove).toHaveBeenCalled());
    expect(ids(qc, "aberto")).toEqual(["e-1"]);
    resolverTarefa!(true);
  });

  it("checagem de tarefa que LANÇA: card volta, avisa, e a promessa do move resolve (sem unhandled rejection)", async () => {
    requestTaskMove.mockImplementationOnce(() => Promise.reject(new Error("rede caiu")));
    const qc = montar(pipelineDe("custom", "meu-funil"), stages, [entryAberto]);
    semear(qc);
    fireEvent.click(screen.getByRole("button", { name: "mover-proposta" }));
    await expect(ultimoMove as Promise<unknown>).resolves.toBeUndefined();
    expect(ids(qc, "aberto")).toEqual(["e-1"]);
    expect(ids(qc, "proposta")).toEqual([]);
    expect(moverAsync).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("soltar na mesma coluna não consulta tarefa", async () => {
    const qc = montar(pipelineDe("custom", "meu-funil"), stages, [entryAberto]);
    semear(qc);
    fireEvent.click(screen.getByRole("button", { name: "mover-aberto" }));
    await waitFor(() => expect(moverAsync).toHaveBeenCalled());
    expect(requestTaskMove).not.toHaveBeenCalled();
  });
});
