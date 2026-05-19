import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeadPanelProvider, useLeadSheet } from "../../hooks/useLeadSheet";
import { LeadDetailDialog } from "../LeadDetailDialog";
import { useEffect } from "react";

// ─── Mocks ────────────────────────────────────────────────────────────

const flagMock = vi.fn();
vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (key: string) => flagMock(key),
}));

const orgMock = vi.fn(() => ({ organizationId: "org-1", isLoading: false }));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => orgMock(),
}));

const trackSpy = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackSpy(...args),
}));

vi.mock("../LeadDetailDialogV1", () => ({
  LeadDetailDialogV1: () => <div data-testid="modal-v1">V1</div>,
}));
vi.mock("../LeadDetailDialogV2", () => ({
  LeadDetailDialogV2: () => <div data-testid="modal-v2">V2</div>,
}));

function OpenLeadOnMount({ leadId = "lead-1" }: { leadId?: string }) {
  const { openLead } = useLeadSheet();
  useEffect(() => {
    openLead(leadId);
  }, [openLead, leadId]);
  return null;
}

function renderWithProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LeadPanelProvider>
        <OpenLeadOnMount />
        <LeadDetailDialog />
      </LeadPanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  flagMock.mockReset();
  trackSpy.mockReset();
  orgMock.mockReset().mockReturnValue({ organizationId: "org-1", isLoading: false });
});

describe("LeadDetailDialog router (issue #301)", () => {
  it("renders V1 when feature flag is disabled", () => {
    flagMock.mockReturnValue({ enabled: false, isLoading: false });
    renderWithProviders();
    expect(screen.getByTestId("modal-v1")).toBeInTheDocument();
    expect(screen.queryByTestId("modal-v2")).not.toBeInTheDocument();
  });

  it("renders V2 when feature flag is enabled", () => {
    flagMock.mockReturnValue({ enabled: true, isLoading: false });
    renderWithProviders();
    expect(screen.getByTestId("modal-v2")).toBeInTheDocument();
    expect(screen.queryByTestId("modal-v1")).not.toBeInTheDocument();
  });

  it("renders V1 while feature flag is still loading (fail-closed to legacy)", () => {
    flagMock.mockReturnValue({ enabled: false, isLoading: true });
    renderWithProviders();
    expect(screen.getByTestId("modal-v1")).toBeInTheDocument();
  });

  it("tracks lead_modal_version_rendered with v2 metadata when flag enabled", () => {
    flagMock.mockReturnValue({ enabled: true, isLoading: false });
    renderWithProviders();
    expect(trackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "lead_modal_version_rendered",
        organizationId: "org-1",
        metadata: { version: "v2" },
      }),
    );
  });

  it("tracks v1 when flag disabled", () => {
    flagMock.mockReturnValue({ enabled: false, isLoading: false });
    renderWithProviders();
    expect(trackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "lead_modal_version_rendered",
        organizationId: "org-1",
        metadata: { version: "v1" },
      }),
    );
  });

  it("does not track while flag is loading", () => {
    flagMock.mockReturnValue({ enabled: false, isLoading: true });
    renderWithProviders();
    expect(trackSpy).not.toHaveBeenCalled();
  });
});
