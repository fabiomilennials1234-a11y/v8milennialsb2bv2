import type { ComponentProps, ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadCardData } from "@/modules/leads";
import type { KanbanColumn } from "@/modules/pipelines/components/kanban/DraggableKanbanBoard";
import { useBulkSelection } from "@/shared/hooks/useBulkSelection";

// ── Chamado f866578d — "Selecionar todos desta etapa" ──────────────────────
// A coluna carrega 20 por página. Selecionar a etapa tem que alcançar o que
// ainda não foi carregado, e a barra de bulk tem que ENXERGAR esses ids:
// `BulkActionBar` filtra `leadIds` pela seleção e age sobre `entryIds`.

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
const toastWarning = vi.fn();
vi.mock("sonner", () => ({ toast: { warning: (...a: unknown[]) => toastWarning(...a) } }));

interface BarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  leadIds: string[];
  escopoFunil?: { pipelineId: string; entryIds?: string[] };
}
let bar: BarProps | null = null;

// Board real é testado à parte; aqui ele só expõe o menu da coluna e os cards.
vi.mock("@/modules/pipelines/components/kanban/DraggableKanbanBoard", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    DraggableKanbanBoard: ({
      columns,
      renderCard,
      onSelectAllStage,
    }: {
      columns: KanbanColumn<LeadCardData>[];
      renderCard: (item: LeadCardData) => ReactNode;
      onSelectAllStage?: (stageId: string) => void;
    }) => (
      <>
        {columns.map((c) => (
          <section key={c.id}>
            {onSelectAllStage && (
              <button onClick={() => onSelectAllStage(c.id)}>Selecionar todos desta etapa · {c.id}</button>
            )}
            {c.items.map((item) => <div key={item.id}>{renderCard(item)}</div>)}
          </section>
        ))}
      </>
    ),
  };
});
vi.mock("@/modules/leads", () => ({
  LeadCard: ({ lead, onSelect }: { lead: LeadCardData; onSelect: (e: { shiftKey: boolean }) => void }) => (
    <button onClick={() => onSelect({ shiftKey: false })}>marcar {lead.leadId}</button>
  ),
  CardEffectsHost: () => null,
  useEntradasEmDesfecho: () => new Set(),
}));
vi.mock("@/modules/identity", () => ({ useCanDo: () => ({ allowed: true }) }));
vi.mock("@/modules/workflows/hooks/useStageWorkflows", () => ({
  useCustomPipeWorkflowCounts: () => ({ data: {} }),
  useCustomPipeStageWorkflows: () => ({ data: [] }),
}));
vi.mock("@/modules/engagement/hooks/useAcoesDoDia", () => ({ useCreateAcaoDoDia: () => ({}) }));
vi.mock("@/modules/pipelines/components/kanban/ExportStageDialog", () => ({ ExportStageDialog: () => null }));
vi.mock("@/modules/pipelines/components/kanban/StageWorkflowsBadge", () => ({ StageWorkflowsBadge: () => null }));
vi.mock("@/modules/pipelines/components/kanban/MergedFunnelCardActions", () => ({ MergedFunnelCardActions: () => null }));
vi.mock("@/modules/leads/components/bulk-actions/BulkActionBar", () => ({
  BulkActionBar: (p: BarProps) => {
    bar = p;
    return <output data-testid="barra">{p.leadIds.filter((id) => p.selectedIds.has(id)).length}</output>;
  },
}));
// Hooks de dados do módulo não rodam aqui — só o helper puro é exercitado.
vi.mock("@/modules/pipelines/hooks/model/useFunilRealtime", () => ({ useFunilRealtime: () => {} }));

const { FunilKanban } = await import("@/modules/pipelines/components/funis/FunilKanban");
const { fetchStageEntryRefs } = await import("@/modules/pipelines/hooks/model/usePaginatedFunil");

/** Etapa com `total` negócios; responde ao cursor como o RPC (created_at DESC, `<`). */
function etapaNoBanco(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `e${i + 1}`,
    lead_id: `l${i + 1}`,
    stage_key: "novo",
    created_at: new Date(Date.UTC(2026, 0, 1) + (total - i) * 1000).toISOString(),
  }));
  rpc.mockImplementation((_fn: string, args: { p_cursor: string | null; p_page_size: number }) => {
    const from = args.p_cursor ? rows.filter((r) => r.created_at < args.p_cursor!) : rows;
    return Promise.resolve({ data: from.slice(0, args.p_page_size), error: null });
  });
  return rows;
}

const filterParams = { p_org_id: "org-1", p_search: "acme", p_responsible_id: "tm-9" } as never;

function renderFunil() {
  const props = {
    pipelineId: "pipe-1",
    stages: [
      { stage_key: "novo", name: "Novo" },
      { stage_key: "outra", name: "Outra" },
    ],
    stageData: {
      novo: {
        items: [
          { id: "e1", lead_id: "l1", stage_key: "novo", created_at: "2026-01-01", lead: { name: "A" } },
          { id: "e2", lead_id: "l2", stage_key: "novo", created_at: "2026-01-01", lead: { name: "B" } },
        ],
        totalCount: 5,
        hasMore: true,
      },
      outra: {
        items: [{ id: "x1", lead_id: "lx", stage_key: "outra", created_at: "2026-01-01", lead: { name: "X" } }],
        totalCount: 1,
        hasMore: false,
      },
    },
    onMove: vi.fn(),
    filterParams,
  } as unknown as ComponentProps<typeof FunilKanban>;
  return render(<FunilKanban {...props} />);
}

beforeEach(() => {
  rpc.mockReset();
  toastWarning.mockReset();
  bar = null;
});

describe("Selecionar todos desta etapa — FunilKanban", () => {
  it("seleciona a etapa inteira, inclusive o não carregado, e a barra age sobre tudo", async () => {
    etapaNoBanco(5);
    renderFunil();

    fireEvent.click(screen.getByRole("button", { name: "Selecionar todos desta etapa · novo" }));

    await waitFor(() => expect(screen.getByTestId("barra")).toHaveTextContent("5"));
    expect([...bar!.selectedIds].sort()).toEqual(["l1", "l2", "l3", "l4", "l5"]);
    expect(bar!.escopoFunil?.entryIds?.slice().sort()).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    // Sem duplicata: os carregados não entram duas vezes na lista da barra.
    expect(bar!.leadIds.filter((id) => id === "l1")).toHaveLength(1);
    // Mesmo recorte da coluna: filtros, funil, etapa.
    expect(rpc).toHaveBeenCalledWith(
      "get_pipeline_page",
      expect.objectContaining({
        p_org_id: "org-1",
        p_search: "acme",
        p_responsible_id: "tm-9",
        p_pipeline_id: "pipe-1",
        p_stage_id: "novo",
        p_cursor: null,
      }),
    );
  });

  it("SOMA à seleção existente (não alterna nem substitui)", async () => {
    etapaNoBanco(5);
    renderFunil();

    fireEvent.click(screen.getByRole("button", { name: "marcar lx" }));
    fireEvent.click(screen.getByRole("button", { name: "Selecionar todos desta etapa · novo" }));
    await waitFor(() => expect(screen.getByTestId("barra")).toHaveTextContent("6"));

    // Repetir não desmarca.
    fireEvent.click(screen.getByRole("button", { name: "Selecionar todos desta etapa · novo" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("barra")).toHaveTextContent("6");
    expect(bar!.escopoFunil?.entryIds).toContain("x1");
  });

  it("limpar a seleção esquece os ids buscados", async () => {
    etapaNoBanco(5);
    renderFunil();

    fireEvent.click(screen.getByRole("button", { name: "Selecionar todos desta etapa · novo" }));
    await waitFor(() => expect(screen.getByTestId("barra")).toHaveTextContent("5"));

    act(() => bar!.onClear());
    expect(bar!.selectedIds.size).toBe(0);
    expect(bar!.leadIds).toEqual(["l1", "l2", "lx"]);
    expect(bar!.escopoFunil?.entryIds).toEqual([]);
  });

  it("acima do teto, seleciona os primeiros 5.000 e avisa o corte", async () => {
    etapaNoBanco(5_003);
    renderFunil();

    fireEvent.click(screen.getByRole("button", { name: "Selecionar todos desta etapa · novo" }));

    await waitFor(() => expect(screen.getByTestId("barra")).toHaveTextContent("5000"));
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it("sem filterParams o menu não oferece a ação", () => {
    const props = {
      pipelineId: "pipe-1",
      stages: [{ stage_key: "novo", name: "Novo" }],
      stageData: { novo: { items: [] } },
      onMove: vi.fn(),
    } as unknown as ComponentProps<typeof FunilKanban>;
    render(<FunilKanban {...props} />);
    expect(screen.queryByRole("button", { name: /Selecionar todos desta etapa/ })).toBeNull();
  });
});

describe("fetchStageEntryRefs", () => {
  it("pagina pelo cursor created_at até a última página e ignora entrada sem lead", async () => {
    const rows = etapaNoBanco(5);
    rows[3].lead_id = null as unknown as string;

    const { refs, truncated } = await fetchStageEntryRefs({
      pipelineId: "pipe-1",
      stageKey: "novo",
      filterParams,
      pageSize: 2,
    });

    expect(truncated).toBe(false);
    expect(refs).toEqual([
      { entryId: "e1", leadId: "l1" },
      { entryId: "e2", leadId: "l2" },
      { entryId: "e3", leadId: "l3" },
      { entryId: "e5", leadId: "l5" },
    ]);
    expect(rpc.mock.calls.map((c) => c[1].p_cursor)).toEqual([null, rows[1].created_at, rows[3].created_at]);
  });

  it("para no teto e marca truncado", async () => {
    etapaNoBanco(7);
    const { refs, truncated } = await fetchStageEntryRefs({
      pipelineId: "pipe-1",
      stageKey: "novo",
      filterParams,
      pageSize: 2,
      cap: 4,
    });
    expect(truncated).toBe(true);
    expect(refs.map((r) => r.leadId)).toEqual(["l1", "l2", "l3", "l4"]);
  });
});

describe("useBulkSelection.addMany", () => {
  it("soma sem alternar", () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggle("a"));
    act(() => result.current.addMany(["a", "b", "c"]));
    expect([...result.current.selectedIds].sort()).toEqual(["a", "b", "c"]);
    act(() => result.current.addMany(["a", "b", "c"]));
    expect(result.current.count).toBe(3);
  });
});

describe("DraggableKanbanBoard — item do menu da coluna", () => {
  async function abrirMenu(props: { onSelectAllStage?: (id: string) => void; selectingStageId?: string | null }) {
    const { DraggableKanbanBoard } = await vi.importActual<
      typeof import("@/modules/pipelines/components/kanban/DraggableKanbanBoard")
    >("@/modules/pipelines/components/kanban/DraggableKanbanBoard");
    render(
      <DraggableKanbanBoard<{ id: string; status: string }>
        columns={[{ id: "novo", title: "Novo", color: "#000", items: [], totalCount: 30, hasMore: true }]}
        onStatusChange={vi.fn()}
        renderCard={() => null}
        {...props}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Ações da etapa Novo" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    return screen.findByRole("menuitem", { name: "Selecionar todos desta etapa" });
  }

  it("dispara com o id da coluna", async () => {
    const onSelectAllStage = vi.fn();
    fireEvent.click(await abrirMenu({ onSelectAllStage }));
    expect(onSelectAllStage).toHaveBeenCalledWith("novo");
  });

  it("fica desabilitado enquanto busca", async () => {
    const item = await abrirMenu({ onSelectAllStage: vi.fn(), selectingStageId: "novo" });
    expect(item).toHaveAttribute("aria-disabled", "true");
  });
});
