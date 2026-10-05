/* eslint-disable @typescript-eslint/no-explicit-any -- harness de integração: dublês de borda (cliente Supabase encadeável, modais stub) são `any` por natureza. */
/**
 * Fluxos ricos do `/funil` (perda, venda, reunião, reagendar) com move REAL e
 * board REAL — integração (portado do harness do QA, volta 1).
 *
 * `useFunilMoveFlow` + `usePaginatedFunil` + `useMoverCardNoFunil` +
 * `patchEntryMetadata` reais sobre UM QueryClient real. Borda dublada: cliente
 * Supabase (banco em memória; TODA escrita em `pipeline_entries` ecoa um UPDATE
 * no canal Realtime 30 ms depois, como o Postgres faria) e os modais de UI.
 * Relógio falso.
 *
 * Referência da main (QA, página + contagem): perda 16+2, venda 16+2, agendar
 * 24+3, reagendar 18+2. Aqui perda/venda = UMA rodada (2+1): o eco do UPDATE
 * de metadata (etapa de origem) e o do move são esperados e consumidos (R3).
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { createContext, useContext } from "react";

const h = vi.hoisted(() => ({
  S: {
    db: new Map<string, any>(),
    page: [] as string[],
    counts: 0,
    escritas: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    gateMeta: null as Promise<void> | null,
    falharMeta: false,
    falharMove: false,
    handlers: [] as Array<(p: unknown) => void>,
  },
  track: vi.fn(),
  logAction: vi.fn(),
  triggerFollowUp: vi.fn().mockResolvedValue(undefined),
  moverNegocio: vi.fn().mockResolvedValue(undefined),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  notifyError: vi.fn(),
}));
const S = h.S;

function emitir(p: unknown) {
  const vivo = S.handlers[S.handlers.length - 1];
  vivo?.(p);
}

vi.mock("@/integrations/supabase/client", () => {
  async function escrever(id: string, patch: Record<string, unknown>) {
    const ehMeta = "metadata" in patch;
    if (ehMeta && S.gateMeta) await S.gateMeta;
    if (ehMeta && S.falharMeta) return { data: null, error: { message: "meta negado" } };
    if (!ehMeta && S.falharMove) return { data: null, error: { message: "move negado" } };
    const row = S.db.get(id);
    if (typeof patch.stage_key === "string") row.stage_key = patch.stage_key;
    if (ehMeta) row.metadata = patch.metadata;
    S.escritas.push({ id, patch });
    const snap = { ...row };
    setTimeout(() => emitir({ eventType: "UPDATE", new: snap, old: { id } }), 30);
    return { data: { ...row }, error: null };
  }
  async function rpc(name: string, args: Record<string, any>) {
    if (name === "get_pipeline_page") {
      S.page.push(args.p_stage_id);
      const rows = [...S.db.values()].filter((r) => r.pipeline_id === args.p_pipeline_id && r.stage_key === args.p_stage_id);
      return { data: rows.map((r) => ({ ...r })), error: null };
    }
    if (name === "get_pipeline_stage_counts_by_id") {
      S.counts++;
      const m: Record<string, number> = {};
      for (const r of S.db.values()) if (r.pipeline_id === args.p_pipeline_id) m[r.stage_key] = (m[r.stage_key] ?? 0) + 1;
      return { data: Object.entries(m).map(([stage_key, cnt]) => ({ stage_key, cnt })), error: null };
    }
    return { data: [], error: null };
  }
  function from(table: string) {
    const st: { op: string; patch: any; f: Record<string, unknown> } = { op: "select", patch: null, f: {} };
    const resolver = async () => {
      if (table === "pipeline_entries" && st.op === "update") return escrever(st.f.id as string, st.patch);
      if (table === "pipeline_entries") return { data: { ...S.db.get(st.f.id as string) }, error: null };
      return { data: null, error: null };
    };
    const b: any = {
      select: () => b, eq: (c: string, v: unknown) => ((st.f[c] = v), b), in: () => b, order: () => b, limit: () => b,
      single: () => b, maybeSingle: () => b,
      update: (p: any) => ((st.op = "update"), (st.patch = p), b), insert: () => ((st.op = "insert"), b),
      then: (ok: any, ko: any) => resolver().then(ok, ko),
    };
    return b;
  }
  return { supabase: { rpc, from, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/shared/realtime/realtime-org-context", async (orig) => ({
  ...(await orig<typeof import("@/shared/realtime/realtime-org-context")>()),
  useRealtimeOrgId: () => "org-1",
}));
vi.mock("@/shared/realtime/useRealtimeChannel", async (orig) => ({
  ...(await orig<typeof import("@/shared/realtime/useRealtimeChannel")>()),
  useRealtimeChannel: (o: { table: string; onEvent: (p: unknown) => void; enabled?: boolean }) => {
    if (o.table === "pipeline_entries" && o.enabled !== false) S.handlers.push(o.onEvent);
    return { state: "joined", diagnostics: [] };
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: h.toastSuccess, error: h.toastError, warning: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/shared/errors", async (orig) => ({
  ...(await orig<typeof import("@/shared/errors")>()),
  notifyError: (...a: unknown[]) => h.notifyError(...a),
}));
vi.mock("@/modules/identity", async (orig) => ({
  ...(await orig<typeof import("@/modules/identity")>()),
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" } }),
}));
vi.mock("@/modules/pipelines/hooks/legacy/usePipeConfirmacao", () => ({
  useUpdatePipeConfirmacao: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/pipelines/lib/moverNegocio", async (orig) => ({
  ...(await orig<typeof import("@/modules/pipelines/lib/moverNegocio")>()),
  moverNegocio: (...a: unknown[]) => h.moverNegocio(...a),
}));
vi.mock("@/modules/pipelines/lib/stageTransition", () => ({ upsertLeadIntoCustomPipe: vi.fn() }));
vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({
  triggerFollowUpAutomation: (...a: unknown[]) => h.triggerFollowUp(...a),
}));
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => h.track(...a), trackModuleVisit: vi.fn() }));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => h.logAction }));
vi.mock("@/modules/leads", () => ({ CompareceuModal: () => null }));
vi.mock("@/modules/carteira/components/proposal/TinyErpConfirmOrderDialog", () => ({ TinyErpConfirmOrderDialog: () => null }));
vi.mock("@/modules/carteira/components/proposal/CadastroExternoConfirmDialog", () => ({ CadastroExternoConfirmDialog: () => null }));
vi.mock("@/modules/carteira/hooks/useTinyErp", () => ({ useTinyErpStatus: () => ({ data: { connected: false } }) }));
vi.mock("@/modules/marketing/hooks/useCadastroExterno", () => ({ useCadastroExternoEnabled: () => false }));
vi.mock("@/modules/pipelines/hooks/config/useLossReasons", () => ({
  useLossReasons: () => ({ data: [{ id: "lr-1", name: "Sem budget" }] }),
}));
vi.mock("@/shared/components/SaleValueRequiredModal", () => ({
  SaleValueRequiredModal: (p: any) =>
    p.open ? <button type="button" onClick={() => p.onConfirm(1234)}>stub-valor-confirmar</button> : null,
}));
vi.mock("@/modules/pipelines/components/kanban/SetMeetingDateModal", () => ({ SetMeetingDateModal: () => null }));
vi.mock("@/modules/pipelines/components/legacy/confirmacao/RescheduleModal", () => ({
  RescheduleModal: (p: any) =>
    p.open ? (
      <button
        type="button"
        onClick={() => {
          // O modal real grava a data e recalcula a etapa pela data (D-x).
          const row = S.db.get(p.pipeItem.id);
          row.stage_key = "confirmar_d1";
          const snap = { ...row };
          setTimeout(() => emitir({ eventType: "UPDATE", new: snap, old: { id: row.id } }), 30);
          p.onSuccess();
        }}
      >
        stub-reagendar-salvar
      </button>
    ) : null,
}));
vi.mock("@/modules/pipelines/components/legacy/confirmacao/AddMeetingModal", () => ({
  AddMeetingModal: (p: any) =>
    p.open ? (
      <button
        type="button"
        onClick={async () => {
          await p.beforeSubmit?.();
          // O modal real cria a reunião e MOVE o negócio pra Confirmação.
          const row = S.db.get(p.moveFromEntryId);
          row.pipeline_id = "pl-conf";
          row.stage_key = "reuniao_agendada";
          const snap = { ...row };
          setTimeout(() => emitir({ eventType: "UPDATE", new: snap, old: { id: row.id } }), 30);
          p.onSuccess?.();
        }}
      >
        stub-agendar
      </button>
    ) : null,
}));
const SelectCtx = createContext<(v: string) => void>(() => {});
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: any) => <SelectCtx.Provider value={onValueChange}>{children}</SelectCtx.Provider>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => {
    const onChange = useContext(SelectCtx);
    return <button type="button" onClick={() => onChange(value)}>{children}</button>;
  },
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick, disabled }: any) => <button type="button" onClick={onClick} disabled={disabled}>{children}</button>,
  AlertDialogCancel: ({ children, onClick }: any) => <button type="button" onClick={onClick}>{children}</button>,
}));

import { useFunilMoveFlow } from "@/modules/pipelines/components/funis/useFunilMoveFlow";
import { usePaginatedFunil } from "@/modules/pipelines/hooks/model/usePaginatedFunil";

import { __limparEcosProprios } from "@/modules/pipelines/lib/funil-move-cache";

/** Avança o relógio falso (ecos de 30 ms, janela de 1 s do Realtime). */
const sleep = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const base = {
  organization_id: "org-1", color: "#fff", is_active: true, is_final_positive: false, is_final_negative: false,
  target_pipeline_id: null, target_stage_id: null, target_pipe_type: null, target_stage_key: null,
  checklist_template_id: null, created_at: "", updated_at: "", pipeline_id: "pl-1", position: 0,
};
const st = (stage_key: string, extra: Record<string, unknown> = {}) => ({ ...base, id: `id-${stage_key}`, name: stage_key, stage_key, stage_role: "open", ...extra });
const STAGES_WA = [
  st("novo"), st("respondeu"), st("f1"), st("f2"), st("f3"),
  st("descartado", { stage_role: "lost" }),
  st("vendido", { stage_role: "won" }),
  st("agendado", { stage_role: "meeting_booked", is_final_positive: true, target_pipe_type: "confirmacao" }),
];
const STAGES_CONF = [
  st("novo"), st("remarcar"), st("confirmacao_no_dia"), st("confirmar_d1"), st("confirmar_d2"),
  st("confirmar_d3"), st("confirmar_d4"), st("confirmar_d5"),
  st("reuniao_marcada", { stage_role: "meeting_booked" }),
];
const pipe = (slug: string) => ({
  id: "pl-1", organization_id: "org-1", name: slug, slug, type: "system", description: null, icon: "t", color: "#fff",
  display_order: 0, is_active: true, config: {}, created_by: null, created_at: "", updated_at: "",
});

let boardAtual: any = null;
function Harness({ pipeline, stages }: { pipeline: any; stages: any[] }) {
  const board = usePaginatedFunil(pipeline.id, stages);
  boardAtual = board;
  const flow = useFunilMoveFlow({
    pipeline,
    pipelines: [pipeline, { ...pipe("confirmacao"), id: "pl-conf" }],
    stages,
    findEntry: (id: string) => Object.values(board.stageData).flatMap((s: any) => s.items).find((e: any) => e.id === id),
  });
  return (
    <>
      {stages.map((s) => (
        <button key={s.stage_key} type="button" onClick={() => flow.requestMove("e-alvo", s)}>{`mover-${s.stage_key}`}</button>
      ))}
      {flow.dialogs}
    </>
  );
}

function semear(stages: any[], origem: string) {
  S.db.clear();
  let n = 0;
  for (const s of stages) for (let j = 0; j < 2; j++) {
    const id = `e-${s.stage_key}-${j}`;
    S.db.set(id, { id, pipeline_id: "pl-1", stage_key: s.stage_key, lead_id: `l-${id}`, created_at: `2026-01-01T00:${String(n++).padStart(2, "0")}:00Z`, metadata: {}, sdr_id: "tm-5" });
  }
  S.db.set("e-alvo", { id: "e-alvo", pipeline_id: "pl-1", stage_key: origem, lead_id: "l-alvo", created_at: "2026-03-01T00:00:00Z", metadata: {}, sdr_id: "tm-5", lead: { id: "l-alvo", name: "Ana" } });
}
async function montar(slug: string, stages: any[], origem: string) {
  semear(stages, origem);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><Harness pipeline={pipe(slug)} stages={stages} /></QueryClientProvider>);
  await waitFor(() => expect(boardAtual.isLoading).toBe(false), { timeout: 5000 });
  await waitFor(() => expect(qc.isFetching()).toBe(0));
  S.page = []; S.counts = 0; S.escritas = [];
  return qc;
}
const onde = () => Object.entries(boardAtual.stageData).filter(([, s]: any) => s.items.some((e: any) => e.id === "e-alvo")).map(([k]) => k);
async function assentar(qc: QueryClient, ms: number) {
  await act(async () => { await sleep(ms); });
  await waitFor(() => expect(qc.isFetching()).toBe(0), { timeout: 8000 });
}
const foto = () => JSON.stringify({ get_pipeline_page: S.page.length, colunas: [...new Set(S.page)].sort(), counts: S.counts });
function rodadas(): string {
  // agrupa buscas consecutivas por janela: devolve a sequência crua para leitura humana
  return S.page.join(",");
}
async function escolherPerda() {
  fireEvent.click(screen.getByRole("button", { name: "mover-descartado" }));
  await screen.findByRole("button", { name: /confirmar perda/i });
  fireEvent.click(screen.getByRole("button", { name: "Sem budget" }));
  fireEvent.click(screen.getByRole("button", { name: /confirmar perda/i }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  __limparEcosProprios();
  vi.clearAllMocks();
  S.handlers = []; S.gateMeta = null; S.falharMeta = false; S.falharMove = false; boardAtual = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("perda (metadata → move)", () => {
  it("card move no clique; metadata antes do move; efeitos pós-move; UMA rodada (main: 16+2)", async () => {
    const qc = await montar("whatsapp", STAGES_WA, "novo");
    let soltar: () => void = () => {};
    S.gateMeta = new Promise<void>((r) => (soltar = r));
    await escolherPerda();
    await act(async () => { await sleep(80); });
    expect(onde()).toEqual(["descartado"]); // otimismo antes do metadata gravar
    soltar(); S.gateMeta = null;
    await assentar(qc, 4800);

    expect(onde()).toEqual(["descartado"]);
    expect(S.db.get("e-alvo").stage_key).toBe("descartado");
    expect(S.db.get("e-alvo").metadata).toMatchObject({ loss_reason_id: "lr-1", loss_reason: "Sem budget" });
    // Ordem das escritas: metadata, depois move.
    expect(S.escritas.map((e) => Object.keys(e.patch))).toEqual([["metadata"], ["stage_key", "stage_changed_at"]]);
    expect(h.logAction).toHaveBeenCalledWith(expect.objectContaining({ leadId: "l-alvo", action: "stage_changed" }));
    expect(h.track).toHaveBeenCalledWith(expect.objectContaining({ event: "card_moved", entityType: "pipe_whatsapp", entityId: "e-alvo", metadata: { from_stage: "novo", to_stage: "descartado" } }));
    expect(h.triggerFollowUp).toHaveBeenCalledWith(expect.objectContaining({ leadId: "l-alvo", pipeType: "whatsapp", stage: "descartado", sourcePipeId: "e-alvo" }));
    // R3: os dois ecos (metadata + move) consumidos — só a reconciliação busca.
    expect(JSON.parse(foto())).toEqual({ get_pipeline_page: 2, colunas: ["descartado", "novo"], counts: 1 });
  });

  it("falha no metadata: nada move (db intacto) e o card volta à origem", async () => {
    const qc = await montar("whatsapp", STAGES_WA, "novo");
    S.falharMeta = true;
    await escolherPerda();
    await assentar(qc, 300);
    expect(onde()).toEqual(["novo"]);
    expect(S.db.get("e-alvo").stage_key).toBe("novo");
    expect(h.notifyError).toHaveBeenCalledTimes(1);
    expect(h.track).not.toHaveBeenCalled();
  });

  it("falha no move (metadata gravou): card volta à origem", async () => {
    const qc = await montar("whatsapp", STAGES_WA, "novo");
    S.falharMove = true;
    await escolherPerda();
    await assentar(qc, 300);
    expect(onde()).toEqual(["novo"]);
    expect(S.db.get("e-alvo").stage_key).toBe("novo");
    expect(h.notifyError).toHaveBeenCalledTimes(1);
    expect(h.track).not.toHaveBeenCalled();
  });
});

describe("venda (guarda de valor → metadata → move)", () => {
  it("valor no metadata, card no destino, toast; UMA rodada (main: 16+2)", async () => {
    const qc = await montar("whatsapp", STAGES_WA, "novo");
    fireEvent.click(screen.getByRole("button", { name: "mover-vendido" }));
    fireEvent.click(await screen.findByRole("button", { name: /stub-valor-confirmar/i }));
    await assentar(qc, 4800);
    expect(onde()).toEqual(["vendido"]);
    expect(S.db.get("e-alvo").metadata).toMatchObject({ sale_value: 1234 });
    expect(h.toastSuccess).toHaveBeenCalledWith("🎉 Venda fechada com sucesso!");
    expect(JSON.parse(foto())).toEqual({ get_pipeline_page: 2, colunas: ["novo", "vendido"], counts: 1 });
  });
});

describe("reunião", () => {
  it("agendar (etapa de sucesso → Confirmação): card sai do funil; board consistente", async () => {
    const qc = await montar("whatsapp", STAGES_WA, "novo");
    fireEvent.click(screen.getByRole("button", { name: "mover-agendado" }));
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /stub-agendar/i })); });
    await assentar(qc, 4800);
    expect(onde()).toEqual([]);
    expect(boardAtual.stageCounts.novo).toBe(2);
    expect(boardAtual.stageCounts.agendado).toBe(2);
    // Só as duas colunas tocadas, nunca o board inteiro (main: 24+3).
    const r = JSON.parse(foto());
    expect(r.colunas).toEqual(["agendado", "novo"]);
    expect(r.get_pipeline_page).toBeLessThanOrEqual(4);
    expect(r.counts).toBeLessThanOrEqual(2);
  });

  it("reagendar (trilho D-x): etapa recalculada pela data aparece no board", async () => {
    const qc = await montar("confirmacao", STAGES_CONF, "novo");
    fireEvent.click(screen.getByRole("button", { name: "mover-reuniao_marcada" }));
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /stub-reagendar-salvar/i })); });
    await assentar(qc, 4800);
    expect(onde()).toEqual(["confirmar_d1"]);
    expect(boardAtual.stageCounts.confirmar_d1).toBe(3);
  });
});
