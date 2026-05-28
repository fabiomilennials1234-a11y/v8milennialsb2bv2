import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeadTagsBar } from "../LeadTagsBar";

// ─── Mocks ──────────────────────────────────────────────────────────

const attachedState = vi.hoisted(() => ({
  list: [] as Array<{ id: string; tag_id: string; tag: { id: string; name: string; color: string | null } }>,
}));

const addSpy = vi.fn().mockResolvedValue({ id: "lt-new", tag_id: "tag-x" });
const removeSpy = vi.fn().mockResolvedValue({});

vi.mock("@/modules/leads/hooks/lead/useLeadTagsAttached", () => ({
  useLeadTagsAttached: () => ({ data: attachedState.list, isLoading: false }),
  useAddLeadTag: () => ({ mutateAsync: addSpy, isPending: false }),
  useRemoveLeadTag: () => ({ mutateAsync: removeSpy, isPending: false }),
}));

vi.mock("@/hooks/useTags", () => ({
  useTags: () => ({
    data: [
      { id: "tag-1", name: "Ouro",       color: "#f0a", organization_id: "org-1" },
      { id: "tag-2", name: "Prata",      color: "#aaa", organization_id: "org-1" },
      { id: "tag-3", name: "Bronze",     color: "#964", organization_id: "org-1" },
    ],
    isLoading: false,
  }),
  useCreateTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: "tag-new", name: "Nova" }) }),
}));

vi.mock("@/modules/leads/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  attachedState.list = [];
  addSpy.mockClear();
  removeSpy.mockClear();
});

describe("LeadTagsBar", () => {
  describe("state: empty (no tags attached)", () => {
    it("renders only the '+ Tag' add button when editable", () => {
      renderWithQuery(<LeadTagsBar leadId="lead-1" editable={true} />);
      expect(screen.getByRole("button", { name: /\+ tag/i })).toBeInTheDocument();
    });

    it("renders empty placeholder + no add button when not editable", () => {
      renderWithQuery(<LeadTagsBar leadId="lead-1" editable={false} />);
      expect(screen.queryByRole("button", { name: /\+ tag/i })).not.toBeInTheDocument();
      expect(screen.getByText(/sem tags/i)).toBeInTheDocument();
    });
  });

  describe("state: with attached tags", () => {
    beforeEach(() => {
      attachedState.list = [
        { id: "lt-1", tag_id: "tag-1", tag: { id: "tag-1", name: "Ouro", color: "#f0a" } },
        { id: "lt-2", tag_id: "tag-2", tag: { id: "tag-2", name: "Prata", color: "#aaa" } },
      ];
    });

    it("renders one chip per attached tag", () => {
      renderWithQuery(<LeadTagsBar leadId="lead-1" editable={true} />);
      expect(screen.getByText("Ouro")).toBeInTheDocument();
      expect(screen.getByText("Prata")).toBeInTheDocument();
    });

    it("calls remove mutation with leadTagId when chip x is clicked", async () => {
      renderWithQuery(<LeadTagsBar leadId="lead-1" editable={true} />);
      const removeBtn = screen.getByRole("button", { name: /remover tag ouro/i });
      fireEvent.click(removeBtn);
      await waitFor(() => {
        expect(removeSpy).toHaveBeenCalledWith({ leadTagId: "lt-1", leadId: "lead-1" });
      });
    });

    it("does not render remove buttons when not editable", () => {
      renderWithQuery(<LeadTagsBar leadId="lead-1" editable={false} />);
      expect(screen.queryByRole("button", { name: /remover tag/i })).not.toBeInTheDocument();
    });
  });

  describe("state: overflow (>6 attached tags)", () => {
    beforeEach(() => {
      attachedState.list = Array.from({ length: 9 }).map((_, i) => ({
        id: `lt-${i}`,
        tag_id: `tag-${i}`,
        tag: { id: `tag-${i}`, name: `Tag ${i + 1}`, color: "#888" },
      }));
    });

    it("shows '+N mais' badge when more than 6 tags", () => {
      renderWithQuery(<LeadTagsBar leadId="lead-1" editable={true} />);
      // Visible chips: 6 (Tag 1 .. Tag 6)
      expect(screen.getByText("Tag 1")).toBeInTheDocument();
      expect(screen.getByText("Tag 6")).toBeInTheDocument();
      // Hidden chips collapsed into "+N mais"
      expect(screen.getByText(/\+3 mais/i)).toBeInTheDocument();
    });
  });

  describe("add flow", () => {
    it("opens combobox + add tag fires mutation with selected tag id", async () => {
      renderWithQuery(<LeadTagsBar leadId="lead-1" editable={true} />);
      fireEvent.click(screen.getByRole("button", { name: /\+ tag/i }));
      // Combobox renders the org tags as selectable options.
      const option = await screen.findByRole("option", { name: /ouro/i });
      fireEvent.click(option);
      await waitFor(() => {
        expect(addSpy).toHaveBeenCalledWith({ leadId: "lead-1", tagId: "tag-1" });
      });
    });
  });
});
