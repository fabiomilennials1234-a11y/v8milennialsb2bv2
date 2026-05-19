/**
 * MobileBottomNav — TDD vertical slices.
 *
 * Cycles:
 *   1. Renders 4 tabs with correct labels
 *   2. Active tab matches current route
 *   3. Tap navigates to correct route
 *   4. Does NOT render on desktop
 *   5. "Mais" tab opens sheet with secondary items
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Mocks ───────────────────────────────────────────────────
const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockViewport = vi.fn(() => ({
  isMobile: true,
  isDesktop: false,
  width: 375,
}));

vi.mock("@/hooks/use-viewport", () => ({
  useViewport: () => mockViewport(),
}));

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

function renderNav(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MobileBottomNav />
    </MemoryRouter>,
  );
}

// ─── Cycle 1: Renders 4 tabs ────────────────────────────────
describe("MobileBottomNav", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockViewport.mockReturnValue({ isMobile: true, isDesktop: false, width: 375 });
  });

  it("renders 4 tabs: Chat, Pipeline, Leads, Mais", () => {
    renderNav();

    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("Mais")).toBeInTheDocument();
  });

  // ─── Cycle 2: Active tab matches route ──────────────────────
  it("highlights Chat tab when on /chat-whatsapp", () => {
    renderNav("/chat-whatsapp");

    const chatTab = screen.getByTestId("tab-chat");
    expect(chatTab).toHaveAttribute("data-active", "true");
  });

  it("highlights Pipeline tab when on /pipe-whatsapp", () => {
    renderNav("/pipe-whatsapp");

    const pipeTab = screen.getByTestId("tab-pipeline");
    expect(pipeTab).toHaveAttribute("data-active", "true");
  });

  it("highlights Leads tab when on /leads", () => {
    renderNav("/leads");

    const leadsTab = screen.getByTestId("tab-leads");
    expect(leadsTab).toHaveAttribute("data-active", "true");
  });

  // ─── Cycle 3: Navigate on tap ──────────────────────────────
  it("navigates to /chat-whatsapp on Chat tap", () => {
    renderNav();

    fireEvent.click(screen.getByTestId("tab-chat"));
    expect(mockNavigate).toHaveBeenCalledWith("/chat-whatsapp");
  });

  it("navigates to /pipe-whatsapp on Pipeline tap", () => {
    renderNav();

    fireEvent.click(screen.getByTestId("tab-pipeline"));
    expect(mockNavigate).toHaveBeenCalledWith("/pipe-whatsapp");
  });

  it("navigates to /leads on Leads tap", () => {
    renderNav();

    fireEvent.click(screen.getByTestId("tab-leads"));
    expect(mockNavigate).toHaveBeenCalledWith("/leads");
  });

  // ─── Cycle 4: Desktop gate ─────────────────────────────────
  it("does NOT render when viewport is desktop", () => {
    mockViewport.mockReturnValue({ isMobile: false, isDesktop: true, width: 1280 });

    const { container } = renderNav();
    expect(container.firstChild).toBeNull();
  });

  // ─── Cycle 5: "Mais" opens sheet ───────────────────────────
  it("opens sheet with secondary nav when Mais is tapped", () => {
    renderNav();

    fireEvent.click(screen.getByTestId("tab-mais"));

    // Sheet should show secondary items
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getByText("Configurações")).toBeInTheDocument();
  });
});
