/**
 * Régua de espera (CX ①, volta 3 — F3-b) — gravações fora de ordem no Funil.
 *
 * Dois `moverAsync` podem estar em voo ao mesmo tempo (a porta de tarefa
 * serializa as checagens, não as escritas). Quando o move MAIS NOVO de uma
 * entrada grava primeiro e o mais antigo falha depois, a reversão do antigo é
 * no-op: o card fica no destino do novo, contagens somam o número de cards.
 *
 * Prelúdio de dublês copiado de `funil-move-flow.test.tsx` (mesmo hook).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { toast } from "sonner";
import { notifyError as notifyErrorQA } from "@/shared/errors";

// Porta REAL (TaskMoveGateProvider em fila); só o RPC é dublê.
type PedidoRpc = { fn: string; args: Record<string, unknown>; resolver: (v: unknown) => void; rejeitar: (e: unknown) => void };
const pedidosRpc: PedidoRpc[] = [];
vi.mock("@/modules/engagement/lib/task-api", () => ({
  taskRpc: (fn: string, args: Record<string, unknown>) => new Promise((resolver, rejeitar) => pedidosRpc.push({ fn, args, resolver, rejeitar })),
}));
let portaQueLanca: null | (() => Promise<boolean>) = null;
vi.mock("@/modules/engagement/tasks", async () => {
  const real = await import("@/modules/engagement/components/tasks/task-move-context");
  return { useTaskMoveGate: () => { const r = real.useTaskMoveGate(); return portaQueLanca ?? r; } };
});

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

vi.mock("@/shared/errors", async (o) => ({ ...(await o<Record<string, unknown>>()), notifyError: vi.fn() }));
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
  useIdentity: () => ({ userId: "u-1" }),
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
import { TaskMoveGateProvider } from "@/modules/engagement/components/tasks/TaskMoveGate";
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
      {entries.flatMap((en) => stages.map((st) => (
        <button
          key={en.id + st.stage_key}
          type="button"
          onClick={() => { void flow.requestMove(en.id, st); }}
        >
          {`mover-${en.id}-${st.stage_key}`}
        </button>
      )))}
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
        <TaskMoveGateProvider>{comPorta ? <LossReasonGateProvider>{harness}</LossReasonGateProvider> : harness}</TaskMoveGateProvider>
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
  pedidosRpc.length = 0;
  portaQueLanca = null;
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


const e1: FunilFlowEntry = { ...entryBase, id: "e-1", stage_key: "aberto", status: "aberto" };
const e2: FunilFlowEntry = { ...entryBase, id: "e-2", lead_id: "lead-2", stage_key: "aberto", status: "aberto", lead: { id: "lead-2", name: "Bia", company: "X", phone: "551188" } };
const st = [stage({ stage_key: "aberto" }), stage({ stage_key: "proposta" }), stage({ stage_key: "negociacao" })];
function semear2(qc: QueryClient) {
  qc.setQueryData(k("aberto"), { pages: [[{ id: "e-1", stage_key: "aberto" }, { id: "e-2", stage_key: "aberto" }]], pageParams: [null] });
  qc.setQueryData(k("proposta"), { pages: [[]], pageParams: [null] });
  qc.setQueryData(k("negociacao"), { pages: [[]], pageParams: [null] });
  qc.setQueryData(countsK, { aberto: 2, proposta: 0, negociacao: 0 });
}
const unhandled: unknown[] = [];
process.on("unhandledRejection", (r) => unhandled.push(r));

const e3: FunilFlowEntry = { ...entryBase, id: "e-3", lead_id: "lead-3", stage_key: "aberto", status: "aberto", lead: { id: "lead-3", name: "Cid", company: "Y", phone: "551177" } };
function semear3(qc: QueryClient) {
  qc.setQueryData(k("aberto"), { pages: [[{ id: "e-1", stage_key: "aberto" }, { id: "e-2", stage_key: "aberto" }, { id: "e-3", stage_key: "aberto" }]], pageParams: [null] });
  qc.setQueryData(k("proposta"), { pages: [[]], pageParams: [null] });
  qc.setQueryData(k("negociacao"), { pages: [[]], pageParams: [null] });
  qc.setQueryData(countsK, { aberto: 3, proposta: 0, negociacao: 0 });
}
const cnt = (qc: QueryClient) => qc.getQueryData(countsK) as Record<string, number>;
const foto = (qc: QueryClient) => ({ aberto: ids(qc, "aberto"), proposta: ids(qc, "proposta"), negociacao: ids(qc, "negociacao"), cnt: cnt(qc) });
const clicar = (n: string) => fireEvent.click(screen.getByRole("button", { name: n }));
async function comTarefa(i: number) {
  await waitFor(() => expect(pedidosRpc.length).toBeGreaterThan(i));
  pedidosRpc[i].resolver([{ id: `t-${i}`, title: "Ligar" }]);
}
async function semTarefa(i: number) {
  await waitFor(() => expect(pedidosRpc.length).toBeGreaterThan(i));
  pedidosRpc[i].resolver([]);
}
const pausa = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const todos = (qc: QueryClient) => [...ids(qc, "aberto"), ...ids(qc, "proposta"), ...ids(qc, "negociacao")];


describe("Funil — gravações fora de ordem na mesma entrada (F3-b)", () => {
  it("mesma entrada 2×: gravação do 1º lenta; 2º grava OK antes; 1º falha depois → fica no destino do 2º, contagens coerentes", async () => {
    let falha1!: (e: unknown) => void;
    moverAsync
      .mockImplementationOnce(() => new Promise((_r, rej) => { falha1 = rej; }))
      .mockImplementationOnce(async () => undefined);
    const qc = montar(pipelineDe("custom", "meu-funil"), st, [e1, e2]);
    semear2(qc);
    clicar("mover-e-1-proposta");
    await semTarefa(0);
    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    clicar("mover-e-1-negociacao");
    await pausa(30);
    const rpcs = pedidosRpc.length;
    if (rpcs > 1) await semTarefa(1);
    await pausa(50);
    const meio = foto(qc);
    const chamadas = moverAsync.mock.calls.length;
    falha1(new Error("timeout de rede"));
    await pausa(80);
    // As duas escritas estavam em voo juntas (senão o cenário não existe).
    expect(chamadas).toBe(2);
    expect(todos(qc).filter((x) => x === "e-1")).toHaveLength(1);
    expect(ids(qc, "negociacao")).toEqual(["e-1"]);
    expect(cnt(qc)).toEqual({ aberto: 1, proposta: 0, negociacao: 1 });
  });

  it("entradas diferentes: gravação do e-1 lenta, e-2 grava OK antes, e-1 falha → só e-1 volta", async () => {
    let falha1!: (e: unknown) => void;
    moverAsync
      .mockImplementationOnce(() => new Promise((_r, rej) => { falha1 = rej; }))
      .mockImplementationOnce(async () => undefined);
    const qc = montar(pipelineDe("custom", "meu-funil"), st, [e1, e2]);
    semear2(qc);
    clicar("mover-e-1-proposta"); clicar("mover-e-2-proposta");
    await semTarefa(0);
    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    await pausa(30);
    if (pedidosRpc.length > 1) await semTarefa(1);
    await pausa(50);
    const chamadas = moverAsync.mock.calls.length;
    falha1(new Error("timeout de rede"));
    await pausa(80);
    expect(ids(qc, "aberto")).toEqual(["e-1"]);
    expect(ids(qc, "proposta")).toEqual(["e-2"]);
    expect(cnt(qc)).toEqual({ aberto: 1, proposta: 1, negociacao: 0 });
  });
});
