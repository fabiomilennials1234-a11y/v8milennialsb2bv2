import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeadModal } from "../LeadModal";
import { MockPipeOpsProvider } from "@/modules/leads/pipe-ops/testing";

// Regressão (hotfix): LeadModal consumia os hooks de pipeline
// (useCustomPipelines, useCustomPipelineStages, useAllPipelineStageOptions,
// useCreatePipe*, useAddLeadToCustomPipe) SEM bindá-los via usePipeOps().
// Pós arch-deepening Fase 7 esses hooks vêm do PipeOpsPort (context); o import
// de `usePipeOps` existia mas a chamada/destructure havia sido omitida na
// migração — só `Leads.tsx` foi convertido. Resultado: ao abrir o modal de
// criação (showPipeSelector = !isEditing && !skipPipeSelector), o bundle do
// Vite/esbuild (sem type-check) referenciava identificadores não-declarados →
// "ReferenceError: useCustomPipelines is not defined".
//
// Este teste monta o modal em modo criação e garante que ele renderiza — i.e.
// que os hooks do port estão bindados — travando a regressão.

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Barrel identity — só os 3 hooks que o LeadModal consome.
vi.mock("@/modules/identity", () => ({
  useTeamMembers: () => ({ data: [] }),
  useCurrentTeamMember: () => ({
    data: { id: "tm-1", organization_id: "org-1" },
    refetch: vi.fn(),
    isLoading: false,
    isFetching: false,
  }),
  useResponsibleMembers: () => [],
}));

vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useCreateLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: "lead-new" }), isPending: false }),
  useUpdateLead: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
}));

vi.mock("@/modules/leads/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("@/modules/leads/hooks/useLeadOrigins", () => ({
  useLeadOrigins: () => ({
    origins: [{ slug: "whatsapp", label: "WhatsApp", color: "#25D366" }],
    labelOf: (s: string) => s,
    colorOf: () => "#64748B",
    isLoading: false,
  }),
}));

vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useLeadCustomFields: () => ({ data: [] }),
  useLeadCustomFieldValues: () => ({ data: [] }),
  useSaveCustomFieldValue: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/modules/leads/hooks/useLeadTimeline", () => ({
  useLeadHistory: () => ({ data: [], isLoading: false }),
}));

// Stub — arrasta hooks próprios (followups) irrelevantes a este teste.
vi.mock("@/modules/engagement/components/followups/ScheduleFollowUpButton", () => ({
  ScheduleFollowUpButton: () => null,
}));

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MockPipeOpsProvider>
        <LeadModal open onOpenChange={() => {}} />
      </MockPipeOpsProvider>
    </QueryClientProvider>,
  );
}

describe("LeadModal — binding de pipe-ops (regressão ReferenceError)", () => {
  it("renderiza em modo criação sem lançar (hooks do PipeOpsPort bindados)", () => {
    expect(() => renderModal()).not.toThrow();
    expect(screen.getByText("Novo Lead")).toBeInTheDocument();
  });
});
