import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { BulkActionBar } from "./BulkActionBar";
import { useBulkMoveToPipeline, useBulkMoveToCustomPipe } from "../../hooks/useBulkActions";
import { MockPipeOpsProvider } from "../../pipe-ops/testing";

// ── Mocks ──────────────────────────────────────────────────────────────────
const rpc = vi.fn();
/** Captura o DELETE em `pipeline_entries` do caminho de negócio (SCRUM-611). */
const deleteSpy = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (tabela: string) => ({
      delete: () => {
        const chamada: Record<string, unknown> = { tabela };
        const encadeavel = {
          eq: (col: string, val: unknown) => { chamada[col] = val; return encadeavel; },
          in: (col: string, val: unknown) => { chamada[col] = val; return encadeavel; },
          select: () => { deleteSpy(chamada); return Promise.resolve({ data: [{ id: "e-1" }], error: null }); },
        };
        return encadeavel;
      },
    }),
  },
}));
vi.mock("@/modules/identity", () => ({
  useTeamMembers: () => ({ data: [] }),
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useCanDo: () => ({ allowed: true, isLoading: false }),
  // SCRUM-641: o diálogo de mover passa a defaultar pro funil PADRÃO da org.
  useOrganizationSettings: () => ({ settings: { default_pipeline_id: null } }),
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({ useTags: () => ({ data: [] }) }));
vi.mock("./QuickBlastDialog", () => ({ QuickBlastDialog: () => null }));
// framer-motion no jsdom: render direto, sem animação.
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => {
    const { children, className } = p as { children?: React.ReactNode; className?: string };
    return <div className={className}>{children}</div>;
  } }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const funnels = [
  { id: "pipe-sys-1", name: "Qualificação", slug: "whatsapp", type: "system", is_active: true },
  { id: "pipe-sys-off", name: "Antigo", slug: "confirmacao", type: "system", is_active: false },
  { id: "pipe-cus-1", name: "Indicações", slug: "indicacoes", type: "custom", is_active: true },
];
const useFunnelStages = vi.fn();

function renderBar(
  selected = new Set(["l-1", "l-2"]),
  escopoFunil?: { pipelineId: string; nomeDoFunil?: string; podeExcluir?: boolean },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MockPipeOpsProvider
        port={{
          useFunnels: (() => ({ data: funnels, isLoading: false })) as never,
          useFunnelStages: useFunnelStages as never,
        }}
      >
        <BulkActionBar
          selectedIds={selected}
          onClear={() => {}}
          leadIds={["l-1", "l-2", "l-3"]}
          escopoFunil={escopoFunil}
        />
      </MockPipeOpsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  deleteSpy.mockReset();
  useFunnelStages.mockReset();
  useFunnelStages.mockReturnValue({
    data: [
      { id: "st-1", stage_key: "novo", name: "Novo", position: 0 },
      { id: "st-2", stage_key: "ganhou", name: "Ganhou", position: 1 },
    ],
    isLoading: false,
  });
});

describe("BulkActionBar — paridade por pipeline_id (SCRUM-633)", () => {
  it("Mover abre o diálogo unificado: etapas resolvidas pelo ID do funil default (nada de PipelineType nem sentinela custom:)", async () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /mover/i }));

    await waitFor(() => expect(screen.getByText("Funil")).toBeInTheDocument());
    // O hack `(isCustom ? "whatsapp" : pipe)` morreu: o dropdown de etapas é
    // alimentado por useFunnelStages(pipeline.id) — default = 1º funil de
    // SISTEMA ativo (paridade com o antigo default "whatsapp").
    expect(useFunnelStages).toHaveBeenCalledWith("pipe-sys-1");
    // Funil inativo não entra na conta do default.
    expect(useFunnelStages).not.toHaveBeenCalledWith("pipe-sys-off");
  });

  it("barra expõe a ação Exportar (seleção manual, agnóstica de funil)", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /exportar/i })).toBeInTheDocument();
  });
});

describe("useBulkMoveToPipeline — motor único bulk_add_to_pipeline", () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("envia p_lead_ids + p_pipeline_id + p_stage_id — mesmo payload p/ funil custom E de sistema", async () => {
    const { result } = renderHook(() => useBulkMoveToPipeline(), { wrapper });
    await result.current.mutateAsync({
      lead_ids: ["l-1", "l-2"],
      pipeline_id: "pipe-sys-1",
      stage_id: "st-2",
    });
    expect(rpc).toHaveBeenCalledWith("bulk_add_to_pipeline", {
      p_lead_ids: ["l-1", "l-2"],
      p_pipeline_id: "pipe-sys-1",
      p_stage_id: "st-2",
    });
  });

  it("alias de compat useBulkMoveToCustomPipe aponta para o mesmo motor", () => {
    expect(useBulkMoveToCustomPipe).toBe(useBulkMoveToPipeline);
  });
});


/**
 * SCRUM-611 — a barra é a MESMA na lista de Leads e no kanban de funil, e o
 * botão vermelho significava a mesma coisa nos dois: mandar a PESSOA para a
 * lixeira. No funil, quem clicava tinha marcado um card de NEGÓCIO — e o lead
 * sumia da lista de Leads, dos outros funis, da carteira e do chat.
 *
 * Estes testes travam a diferença. Se alguém remover `escopoFunil` do
 * FunilKanban, o primeiro deles cai.
 */
describe("BulkActionBar — o botão vermelho fala a língua da tela (SCRUM-611)", () => {
  it("dentro de um funil, exclui o NEGÓCIO — apaga a entry, não manda a pessoa para a lixeira", async () => {
    renderBar(new Set(["l-1", "l-2"]), { pipelineId: "pipe-cus-1" });

    fireEvent.click(screen.getByRole("button", { name: /excluir negócios/i }));
    await waitFor(() =>
      expect(screen.getByText(/as pessoas continuam na base/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^excluir 2 negócios$/i }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalled());
    expect(deleteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tabela: "pipeline_entries",
        pipeline_id: "pipe-cus-1",
        lead_id: ["l-1", "l-2"],
      }),
    );
    // 🚨 A regressão que este teste existe para pegar.
    expect(rpc).not.toHaveBeenCalledWith("bulk_delete_leads", expect.anything());
  });

  it("na lista de Leads (sem escopo de funil), segue excluindo a PESSOA", async () => {
    renderBar(new Set(["l-1"]));

    fireEvent.click(screen.getByRole("button", { name: /^excluir$/i }));
    // Ancora na DESCRIÇÃO, não no título: título e botão de confirmação usam a
    // mesma frase ("Excluir 1 leads") e `getByText` acha os dois.
    await waitFor(() =>
      expect(screen.getByText(/movidos para a lixeira/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /excluir 1 leads/i }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("bulk_delete_leads", { p_lead_ids: ["l-1"] }));
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("o rótulo do botão nunca diz apenas 'Excluir' dentro de um funil", () => {
    renderBar(new Set(["l-1"]), { pipelineId: "pipe-cus-1" });
    expect(screen.getByRole("button", { name: /excluir negócio/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^excluir$/i })).not.toBeInTheDocument();
  });

  it("o escopo NUNCA vaza para outros funis: o delete carrega o pipeline_id", async () => {
    renderBar(new Set(["l-1"]), { pipelineId: "pipe-sys-1" });
    fireEvent.click(screen.getByRole("button", { name: /excluir negócio/i }));
    await waitFor(() => expect(screen.getByText(/a pessoa continua na base/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^excluir 1 negócio$/i }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalled());
    expect(deleteSpy.mock.calls[0][0]).toHaveProperty("pipeline_id", "pipe-sys-1");
  });

  it("sem permissão, o botão destrutivo some", () => {
    renderBar(new Set(["l-1"]), { pipelineId: "pipe-cus-1", podeExcluir: false });
    expect(screen.queryByRole("button", { name: /excluir/i })).not.toBeInTheDocument();
  });
});
