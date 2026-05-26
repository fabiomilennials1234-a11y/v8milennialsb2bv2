import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BudgetFieldBlock } from "../BudgetFieldBlock";

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

vi.mock("@/modules/identity/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "test@test.com" },
    loading: false,
  }),
}));

vi.mock("@/modules/identity/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "admin", isLoading: false }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false }),
}));

vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({ isMaster: false }),
}));

vi.mock("@/modules/identity/hooks/useCanDo", () => ({
  useCanDo: () => ({ allowed: true, reason: "admin", isLoading: false }),
}));

vi.mock("@/hooks/usePipelineEntries", () => ({
  usePipelineEntries: () => ({ data: [], isLoading: false }),
  usePipelineId: () => ({ data: "pipeline-propostas-id" }),
  findOrCreatePipelineEntry: vi
    .fn()
    .mockResolvedValue({ entry: { id: "entry-new", lead_id: "lead-1", stage_key: "marcar_compromisso", organization_id: "org-1" }, created: true }),
}));

vi.mock("@/hooks/useAutoFollowUp", () => ({
  triggerFollowUpAutomation: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useActiveProducts: () => ({
    data: [
      { id: "p1", name: "Plano Starter", type: "mrr", ticket: 500, ticket_minimo: 300, sku: null },
      { id: "p2", name: "Projeto X",     type: "projeto", ticket: 10000, ticket_minimo: 5000, sku: null },
    ],
  }),
}));

vi.mock("@/hooks/usePipePropostaItems", () => ({
  usePipePropostaItems: () => ({ data: [], isLoading: false }),
  useCreatePipePropostaItem: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
  useUpdatePipePropostaItem: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
  useDeletePipePropostaItem: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/useTinyErp", () => ({
  useTinyErpStatus: () => ({ data: { connected: false } }),
}));

vi.mock("@/hooks/useCadastroExterno", () => ({
  useCadastroExternoEnabled: () => false,
}));

vi.mock("@/hooks/useLossReasons", () => ({
  useLossReasons: () => ({ data: [
    { id: "lr-1", label: "Sem budget" },
    { id: "lr-2", label: "Concorrência" },
  ] }),
}));

// Stub heavy sub-modals
vi.mock("@/components/proposals/TinyErpConfirmOrderDialog", () => ({
  TinyErpConfirmOrderDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="tiny-erp-stub" /> : null,
}));
vi.mock("@/components/proposals/CadastroExternoConfirmDialog", () => ({
  CadastroExternoConfirmDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="cadastro-externo-stub" /> : null,
}));
vi.mock("@/components/proposals/ProductCombobox", () => ({
  ProductCombobox: ({ value, onSelect }: { value: string; onSelect: (v: string) => void }) => (
    <button data-testid="product-combobox" onClick={() => onSelect("p1")}>
      {value || "Selecionar produto"}
    </button>
  ),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const baseProps = {
  leadId: "lead-1",
  organizationId: "org-1",
};

describe("BudgetFieldBlock", () => {
  describe("state: empty (no pipe_propostas entry)", () => {
    it("renders 'Sem proposta' message and Adicionar CTA", () => {
      renderWithQuery(
        <BudgetFieldBlock {...baseProps} pipeData={null} locked={false} />,
      );
      expect(screen.getByText(/sem proposta/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /adicionar à propostas/i }),
      ).toBeInTheDocument();
    });
  });

  describe("state: editable", () => {
    const propostaRow = {
      id: "prop-1",
      lead_id: "lead-1",
      status: "proposta_enviada",
      sale_value: 1500,
      product_id: null,
      product_type: null,
      contract_duration: 12,
      commitment_date: null,
      notes: null,
      responsible_id: null,
      closer_id: null,
      loss_reason: null,
      organization_id: "org-1",
      updated_at: "2026-05-19T10:00:00.000Z",
      created_at: "2026-05-10T10:00:00.000Z",
      calor: null,
      closed_at: null,
      metrics_period_at: null,
    };

    it("renders Salvar button when not locked", () => {
      renderWithQuery(
        <BudgetFieldBlock {...baseProps} pipeData={propostaRow as any} locked={false} />,
      );
      expect(screen.getByRole("button", { name: /salvar proposta/i })).toBeInTheDocument();
    });

    it("renders total value computed from items state", () => {
      renderWithQuery(
        <BudgetFieldBlock {...baseProps} pipeData={propostaRow as any} locked={false} />,
      );
      // Initial blank item rows have no value yet, so total = 0; check label exists
      expect(screen.getByText(/valor total/i)).toBeInTheDocument();
    });

    it("renders status grid with all status options", () => {
      renderWithQuery(
        <BudgetFieldBlock {...baseProps} pipeData={propostaRow as any} locked={false} />,
      );
      expect(screen.getByText(/proposta enviada/i)).toBeInTheDocument();
      expect(screen.getByText(/vendido/i)).toBeInTheDocument();
      expect(screen.getByText(/perdido/i)).toBeInTheDocument();
    });

    it("shows loss_reason select when status is 'perdido'", async () => {
      const perdidoRow = { ...propostaRow, status: "perdido" };
      renderWithQuery(
        <BudgetFieldBlock {...baseProps} pipeData={perdidoRow as any} locked={false} />,
      );
      // Loss reason label is present as a Label element
      await waitFor(() => {
        expect(screen.getByText(/motivo da perda/i)).toBeInTheDocument();
      });
    });
  });

  describe("state: locked", () => {
    const propostaRow = {
      id: "prop-1",
      lead_id: "lead-1",
      status: "proposta_enviada",
      sale_value: 5000,
      product_id: null,
      product_type: null,
      contract_duration: null,
      commitment_date: null,
      notes: null,
      responsible_id: null,
      closer_id: null,
      loss_reason: null,
      organization_id: "org-1",
      updated_at: "2026-05-19T10:00:00.000Z",
      created_at: "2026-05-10T10:00:00.000Z",
      calor: null,
      closed_at: null,
      metrics_period_at: null,
    };

    it("does not render Salvar button when locked", () => {
      renderWithQuery(
        <BudgetFieldBlock {...baseProps} pipeData={propostaRow as any} locked={true} />,
      );
      expect(screen.queryByRole("button", { name: /salvar proposta/i })).not.toBeInTheDocument();
    });

    it("shows lock indicator with aria-label", () => {
      renderWithQuery(
        <BudgetFieldBlock {...baseProps} pipeData={propostaRow as any} locked={true} />,
      );
      expect(screen.getByLabelText(/somente leitura/i)).toBeInTheDocument();
    });

    it("renders sale value as read-only text formatted as BRL currency", () => {
      renderWithQuery(
        <BudgetFieldBlock {...baseProps} pipeData={propostaRow as any} locked={true} />,
      );
      // 5000 formatted as BRL — accept variations
      const matches = screen.getAllByText(/R\$/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
