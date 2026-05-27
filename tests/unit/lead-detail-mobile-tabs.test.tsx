import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeadDetailMobileTabs } from "@/modules/leads";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

function renderTabs(props?: Partial<Parameters<typeof LeadDetailMobileTabs>[0]>) {
  return render(
    <LeadDetailMobileTabs
      infoContent={<div data-testid="info-content">Info block</div>}
      historyContent={<div data-testid="history-content">History block</div>}
      chatContent={<div data-testid="chat-content">Chat block</div>}
      leadPhone="+5511999999999"
      {...props}
    />,
  );
}

describe("LeadDetailMobileTabs", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  // ── Cycle 1: Tab structure ────────────────────────────────
  describe("tab structure", () => {
    it("renders 3 tab triggers: Info, Historico, Chat", () => {
      renderTabs();
      expect(screen.getByRole("tab", { name: /info/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /hist[oó]rico/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /chat/i })).toBeInTheDocument();
    });

    it("shows Info tab content by default", () => {
      renderTabs();
      expect(screen.getByTestId("info-content")).toBeInTheDocument();
    });

    it("switches to Historico tab on click", async () => {
      const user = userEvent.setup();
      renderTabs();
      await user.click(screen.getByRole("tab", { name: /hist[oó]rico/i }));
      expect(screen.getByTestId("history-content")).toBeInTheDocument();
    });

    it("switches to Chat tab on click", async () => {
      const user = userEvent.setup();
      renderTabs();
      await user.click(screen.getByRole("tab", { name: /chat/i }));
      expect(screen.getByTestId("chat-content")).toBeInTheDocument();
    });
  });

  // ── Cycle 2: CTA "Abrir conversa" ────────────────────────
  describe("CTA button", () => {
    it("renders sticky 'Abrir conversa' button", () => {
      renderTabs();
      expect(screen.getByRole("button", { name: /abrir conversa/i })).toBeInTheDocument();
    });

    it("navigates to /chat-whatsapp on CTA click", async () => {
      const user = userEvent.setup();
      renderTabs();
      await user.click(screen.getByRole("button", { name: /abrir conversa/i }));
      expect(mockNavigate).toHaveBeenCalledWith("/chat-whatsapp");
    });

    it("hides CTA when leadPhone is null", () => {
      renderTabs({ leadPhone: null });
      expect(screen.queryByRole("button", { name: /abrir conversa/i })).not.toBeInTheDocument();
    });
  });

  // ── Cycle 4: Drag handle ──────────────────────────────────
  describe("drag handle", () => {
    it("renders drag handle indicator at top", () => {
      renderTabs();
      expect(screen.getByTestId("mobile-drag-handle")).toBeInTheDocument();
    });
  });
});
