import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { LeadPanelProvider } from "../hooks/useLeadSheet";
import { LeadDetailSheet } from "../LeadDetailSheet";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { message: "not found" } }),
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          in: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Paths relativos pós-slice 4 (módulo `src/modules/leads/`) — devem
// resolver para o mesmo arquivo importado por `LeadDetailSheet.tsx`.
vi.mock("../../../hooks/useLeads", () => ({
  useToggleLeadAI: () => ({ mutate: vi.fn() }),
  useDeleteLead: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LeadPanelProvider>
          {ui}
        </LeadPanelProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

describe("LeadDetailSheet", () => {
  it("renders nothing when panel is closed", () => {
    const { container } = renderWithProviders(<LeadDetailSheet />);
    expect(container.innerHTML).toBe("");
  });
});
