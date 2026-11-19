/**
 * Funil — moves otimistas SOBREPOSTOS (CX ①, volta 2, F3).
 *
 * A checagem de tarefa é uma fila: o 2º (e o 3º) arrasto já está no destino
 * enquanto o 1º espera o modal. Cancelar / errar um move devolve SÓ aquele
 * card, na posição em que estava, com contagens ±1; os outros ficam onde estão.
 *
 * Porta REAL (`TaskMoveGateProvider`); só o RPC de tarefa é dublê. Otimismo e
 * reversão são os REAIS sobre o QueryClient do teste. Prelúdio de dublês
 * copiado de `funil-move-flow.test.tsx` (mesmo hook).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { notifyError } from "@/shared/errors";

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

const moverAsync = vi.fn<(v: { entryId: string }) => Promise<unknown>>().mockResolvedValue(undefined);
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


const entrada = (id: string, n: number): FunilFlowEntry => ({
  ...entryBase, id, lead_id: `lead-${n}`, stage_key: "aberto", status: "aberto",
  lead: { id: `lead-${n}`, name: `L${n}`, company: "X", phone: `55119900${n}` },
});
const E = [entrada("e-1", 1), entrada("e-2", 2), entrada("e-3", 3)];
const DESTINOS = ["proposta", "negociacao", "contrato"];
const st = [stage({ stage_key: "aberto" }), ...DESTINOS.map((s) => stage({ stage_key: s }))];

function semearN(qc: QueryClient, n: number) {
  qc.setQueryData(k("aberto"), { pages: [E.slice(0, n).map((e) => ({ id: e.id, stage_key: "aberto" }))], pageParams: [null] });
  for (const d of DESTINOS) qc.setQueryData(k(d), { pages: [[]], pageParams: [null] });
  qc.setQueryData(countsK, { aberto: n, proposta: 0, negociacao: 0, contrato: 0 });
}
const contagens = (qc: QueryClient) => qc.getQueryData<Record<string, number>>(countsK)!;

/** Responde a checagem da vez: sem pendência (libera) ou com pendência + "Voltar". */
async function responderChecagem(i: number, desfecho: "confirmar" | "cancelar" | "erro") {
  await waitFor(() => expect(pedidosRpc).toHaveLength(i + 1));
  if (desfecho === "cancelar") {
    pedidosRpc[i].resolver([{ id: `t-${i}`, title: "Ligar" }]);
    fireEvent.click(await screen.findByRole("button", { name: "Voltar" }));
  } else {
    pedidosRpc[i].resolver([]);
  }
}

describe("repro do qa — 2º arrasto durante a checagem do 1º", () => {
  it("1º CANCELADO: o 2º (ainda na fila) não volta em silêncio e é gravado no lugar", async () => {
    const qc = montar(pipelineDe("custom", "meu-funil"), st, E.slice(0, 2));
    semearN(qc, 2);
    fireEvent.click(screen.getByRole("button", { name: "mover-e-1-proposta" }));
    await waitFor(() => expect(pedidosRpc).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "mover-e-2-proposta" }));
    await waitFor(() => expect(ids(qc, "proposta")).toContain("e-2"));
    pedidosRpc[0].resolver([{ id: "t-1", title: "Ligar" }]);
    fireEvent.click(await screen.findByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(ids(qc, "aberto")).toEqual(["e-1"]));
    // Enquanto o 2º ainda checa, ele continua no destino.
    expect(ids(qc, "proposta")).toEqual(["e-2"]);
    expect(contagens(qc)).toMatchObject({ aberto: 1, proposta: 1 });
    await waitFor(() => expect(pedidosRpc).toHaveLength(2));
    pedidosRpc[1].resolver([]);
    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    expect(moverAsync.mock.calls[0][0]).toMatchObject({ entryId: "e-2" });
    expect(ids(qc, "proposta")).toEqual(["e-2"]);
    expect(ids(qc, "aberto")).toEqual(["e-1"]);
  });

  it("1º cancelado, 2º para OUTRA coluna: sem card duplicado nem 2º devolvido", async () => {
    const qc = montar(pipelineDe("custom", "meu-funil"), st, E.slice(0, 2));
    semearN(qc, 2);
    fireEvent.click(screen.getByRole("button", { name: "mover-e-1-proposta" }));
    await waitFor(() => expect(pedidosRpc).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "mover-e-2-negociacao" }));
    await waitFor(() => expect(ids(qc, "negociacao")).toContain("e-2"));
    await responderChecagem(0, "cancelar");
    await waitFor(() => expect(ids(qc, "aberto")).toEqual(["e-1"]));
    expect(ids(qc, "negociacao")).toEqual(["e-2"]);
    expect(ids(qc, "proposta")).toEqual([]);
    await responderChecagem(1, "confirmar");
    await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(1));
    expect(contagens(qc)).toEqual({ aberto: 1, proposta: 0, negociacao: 1, contrato: 0 });
  });

  it("os dois cancelados: os dois voltam à origem, na ordem, nada fantasma no destino", async () => {
    const qc = montar(pipelineDe("custom", "meu-funil"), st, E.slice(0, 2));
    semearN(qc, 2);
    fireEvent.click(screen.getByRole("button", { name: "mover-e-1-proposta" }));
    await waitFor(() => expect(pedidosRpc).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "mover-e-2-proposta" }));
    await waitFor(() => expect(ids(qc, "proposta")).toContain("e-2"));
    await responderChecagem(0, "cancelar");
    await responderChecagem(1, "cancelar");
    await waitFor(() => expect(ids(qc, "aberto")).toEqual(["e-1", "e-2"]));
    expect(moverAsync).not.toHaveBeenCalled();
    expect(ids(qc, "proposta")).toEqual([]);
    expect(contagens(qc)).toEqual({ aberto: 2, proposta: 0, negociacao: 0, contrato: 0 });
  });
});

describe("mesma entrada arrastada duas vezes com a checagem aberta", () => {
  it("a→proposta e →negociacao; cancelar o 1º não mexe; cancelar o 2º volta para a ORIGEM do 1º", async () => {
    const qc = montar(pipelineDe("custom", "meu-funil"), st, E.slice(0, 1));
    semearN(qc, 1);
    fireEvent.click(screen.getByRole("button", { name: "mover-e-1-proposta" }));
    await waitFor(() => expect(pedidosRpc).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "mover-e-1-negociacao" }));
    await waitFor(() => expect(ids(qc, "negociacao")).toEqual(["e-1"]));
    await responderChecagem(0, "cancelar");
    await new Promise((r) => setTimeout(r, 20));
    expect(ids(qc, "negociacao")).toEqual(["e-1"]);
    expect(ids(qc, "aberto")).toEqual([]);
    await responderChecagem(1, "cancelar");
    await waitFor(() => expect(ids(qc, "aberto")).toEqual(["e-1"]));
    expect(ids(qc, "proposta")).toEqual([]);
    expect(ids(qc, "negociacao")).toEqual([]);
    expect(contagens(qc)).toEqual({ aberto: 1, proposta: 0, negociacao: 0, contrato: 0 });
  });
});

type Desfecho = "confirmar" | "cancelar" | "erro";
const DESFECHOS: Desfecho[] = ["confirmar", "cancelar", "erro"];
const produto = (n: number): Desfecho[][] =>
  n === 0 ? [[]] : produto(n - 1).flatMap((c) => DESFECHOS.map((d) => [...c, d]));

describe("matriz — 2 e 3 cards sobrepostos × cancelar/confirmar/erro", () => {
  for (const n of [2, 3]) {
    for (const modo of ["mesma coluna", "colunas diferentes"] as const) {
      it.each(produto(n).map((c) => [c.join(", "), c] as const))(`${n} cards, ${modo}: %s`, async (_nome, desfechos) => {
        const destino = (i: number) => (modo === "mesma coluna" ? "proposta" : DESTINOS[i]);
        moverAsync.mockImplementation(async ({ entryId }) => {
          const i = E.findIndex((e) => e.id === entryId);
          if (desfechos[i] === "erro") throw new Error("gravação recusada");
          return undefined;
        });
        const qc = montar(pipelineDe("custom", "meu-funil"), st, E.slice(0, n));
        semearN(qc, n);
        for (let i = 0; i < n; i++) {
          fireEvent.click(screen.getByRole("button", { name: `mover-${E[i].id}-${destino(i)}` }));
          await waitFor(() => expect(ids(qc, destino(i))).toContain(E[i].id));
        }
        // Todos no destino ao mesmo tempo, um só em checagem.
        expect(ids(qc, "aberto")).toEqual([]);
        expect(pedidosRpc).toHaveLength(1);
        for (let i = 0; i < n; i++) await responderChecagem(i, desfechos[i]);
        const gravados = desfechos.filter((d) => d !== "cancelar").length;
        await waitFor(() => expect(moverAsync).toHaveBeenCalledTimes(gravados));
        const ficam = E.slice(0, n).filter((_, i) => desfechos[i] !== "confirmar").map((e) => e.id);
        await waitFor(() => expect(ids(qc, "aberto")).toEqual(ficam));
        const esperado: Record<string, number> = { aberto: ficam.length, proposta: 0, negociacao: 0, contrato: 0 };
        for (let i = 0; i < n; i++) {
          const d = destino(i);
          const deveEstar = desfechos[i] === "confirmar";
          if (deveEstar) esperado[d] += 1;
          expect(ids(qc, d).includes(E[i].id)).toBe(deveEstar);
        }
        expect(contagens(qc)).toEqual(esperado);
        // Nenhum card em duas colunas.
        const todos = ["aberto", ...DESTINOS].flatMap((s) => ids(qc, s));
        expect(new Set(todos).size).toBe(todos.length);
        if (desfechos.includes("erro")) expect(vi.mocked(notifyError)).toHaveBeenCalled();
      });
    }
  }
});
