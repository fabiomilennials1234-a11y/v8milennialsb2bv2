import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFeatureFlag } from "./useFeatureFlag";

const orgMock = vi.fn();
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: (...a: unknown[]) => orgMock(...a),
}));

const supabaseFromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => supabaseFromMock(...a),
  },
}));

function makeOrgFlagsQuery(flags: Record<string, unknown> | null) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: flags === null ? null : { feature_flags: flags }, error: null }),
      }),
    }),
  };
}

function wrap(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  orgMock.mockReset();
  supabaseFromMock.mockReset();
});

describe("useFeatureFlag", () => {
  it("returns enabled=false, isLoading=true while org is loading", () => {
    orgMock.mockReturnValue({ organizationId: null, isLoading: true, isReady: false });
    const qc = new QueryClient();
    const { result } = renderHook(() => useFeatureFlag("new_lead_modal_v2"), { wrapper: wrap(qc) });
    expect(result.current.enabled).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it("returns enabled=true when flag is true on the org row", async () => {
    orgMock.mockReturnValue({ organizationId: "org-1", isLoading: false, isReady: true });
    supabaseFromMock.mockReturnValue(makeOrgFlagsQuery({ new_lead_modal_v2: true }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useFeatureFlag("new_lead_modal_v2"), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(true);
  });

  it("returns enabled=false when flag key is missing on the org row", async () => {
    orgMock.mockReturnValue({ organizationId: "org-1", isLoading: false, isReady: true });
    supabaseFromMock.mockReturnValue(makeOrgFlagsQuery({ other_flag: true }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useFeatureFlag("new_lead_modal_v2"), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("returns enabled=false when feature_flags is null/empty object", async () => {
    orgMock.mockReturnValue({ organizationId: "org-1", isLoading: false, isReady: true });
    supabaseFromMock.mockReturnValue(makeOrgFlagsQuery({}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useFeatureFlag("new_lead_modal_v2"), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("treats truthy non-boolean as enabled=false (only strict true counts)", async () => {
    orgMock.mockReturnValue({ organizationId: "org-1", isLoading: false, isReady: true });
    supabaseFromMock.mockReturnValue(makeOrgFlagsQuery({ new_lead_modal_v2: "yes" }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useFeatureFlag("new_lead_modal_v2"), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("returns enabled=false when org row not found", async () => {
    orgMock.mockReturnValue({ organizationId: "org-1", isLoading: false, isReady: true });
    supabaseFromMock.mockReturnValue(makeOrgFlagsQuery(null));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useFeatureFlag("new_lead_modal_v2"), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });
});
