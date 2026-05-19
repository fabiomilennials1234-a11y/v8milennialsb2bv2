import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UpsellPipeSection } from "../UpsellPipeSection";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    }),
  },
}));

const upsellMock = vi.fn();
vi.mock("@/hooks/useUpsellClientByLeadId", () => ({
  useUpsellClientByLeadId: (...args: unknown[]) => upsellMock(...args),
}));

// Stub the heavy ClientDetailModal — only need to assert it opens.
vi.mock("@/components/upsell/ClientDetailModal", () => ({
  ClientDetailModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="client-detail-modal-stub" /> : null,
}));

function renderSection(props: Partial<Parameters<typeof UpsellPipeSection>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UpsellPipeSection
        leadId={props.leadId ?? "lead-1"}
        propostaData={props.propostaData ?? null}
        open={props.open ?? true}
        onToggle={props.onToggle ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  upsellMock.mockReset();
});

describe("UpsellPipeSection", () => {
  describe("lead not in carteira", () => {
    it("shows 'Não está na carteira' badge and disabled 'Promover a Cliente' when no closed sale", () => {
      upsellMock.mockReturnValue({ data: null, isLoading: false });
      renderSection({ propostaData: null });
      expect(screen.getByText(/não está na carteira/i)).toBeInTheDocument();
      const cta = screen.getByTestId("promote-to-carteira-cta");
      expect(cta).toBeDisabled();
    });

    it("enables 'Promover a Cliente' CTA when propostaData.status is 'vendido'", () => {
      upsellMock.mockReturnValue({ data: null, isLoading: false });
      renderSection({
        propostaData: { status: "vendido" } as Parameters<typeof UpsellPipeSection>[0]["propostaData"],
      });
      const cta = screen.getByTestId("promote-to-carteira-cta");
      expect(cta).not.toBeDisabled();
    });
  });

  describe("lead in carteira", () => {
    const clientRow = {
      id: "upsell-1",
      lead_id: "lead-1",
      name: "Cliente X",
      first_sale_at: "2026-01-15T12:00:00Z",
      potencial: "alto",
      tipo_cliente_tempo: "cliente_atual",
    };

    it("renders first_sale_at + potencial + status badge", () => {
      upsellMock.mockReturnValue({ data: clientRow, isLoading: false });
      renderSection();
      expect(screen.getByText(/\d{2}\/01\/2026/)).toBeInTheDocument();
      expect(screen.getByText(/alto/i)).toBeInTheDocument();
      expect(screen.getByText(/cliente atual/i)).toBeInTheDocument();
    });

    it("opens ClientDetailModal when 'Abrir gestão completa' is clicked", () => {
      upsellMock.mockReturnValue({ data: clientRow, isLoading: false });
      renderSection();
      expect(screen.queryByTestId("client-detail-modal-stub")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("open-client-detail"));
      expect(screen.getByTestId("client-detail-modal-stub")).toBeInTheDocument();
    });
  });
});
