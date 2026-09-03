/**
 * MobileBottomNav — TDD vertical slices.
 *
 * Cycles:
 *   1. Renders 5 tabs with correct labels
 *   2. Active tab matches current route (Funis cobre os pipes)
 *   3. Tap navigates to correct route
 *   4. Does NOT render on desktop
 *   5. "Mais" dispatches v8:open-mobile-nav (abre Sheet full do TopNavigation)
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

vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => mockViewport(),
}));

import { MobileBottomNav } from "@/modules/platform/components/layout/MobileBottomNav";

function renderNav(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MobileBottomNav />
    </MemoryRouter>,
  );
}

// ─── Cycle 1: Renders 5 tabs ────────────────────────────────
describe("MobileBottomNav", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockViewport.mockReturnValue({ isMobile: true, isDesktop: false, width: 375 });
  });

  it("renders 5 tabs: Chat, Funis, Leads, Agenda, Mais", () => {
    renderNav();

    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Funis")).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getByText("Mais")).toBeInTheDocument();
  });

  // ─── Cycle 2: Active tab matches route ──────────────────────
  it("highlights Chat tab when on /chat-whatsapp", () => {
    renderNav("/chat-whatsapp");
    expect(screen.getByTestId("tab-chat")).toHaveAttribute("data-active", "true");
  });

  it("highlights Funis tab when on /funil/whatsapp (rota única pós-637)", () => {
    renderNav("/funil/whatsapp");
    expect(screen.getByTestId("tab-funis")).toHaveAttribute("data-active", "true");
  });

  it("highlights Funis tab when on /custom-pipeline/abc", () => {
    renderNav("/custom-pipeline/abc");
    expect(screen.getByTestId("tab-funis")).toHaveAttribute("data-active", "true");
  });

  it("highlights Leads tab when on /leads", () => {
    renderNav("/leads");
    expect(screen.getByTestId("tab-leads")).toHaveAttribute("data-active", "true");
  });

  it("highlights Agenda tab when on /agenda", () => {
    renderNav("/agenda");
    expect(screen.getByTestId("tab-agenda")).toHaveAttribute("data-active", "true");
  });

  // ─── Cycle 3: Navigate on tap ──────────────────────────────
  it("navigates to /chat-whatsapp on Chat tap", () => {
    renderNav();
    fireEvent.click(screen.getByTestId("tab-chat"));
    expect(mockNavigate).toHaveBeenCalledWith("/chat-whatsapp");
  });

  it("navigates to /funis on Funis tap", () => {
    renderNav();
    fireEvent.click(screen.getByTestId("tab-funis"));
    expect(mockNavigate).toHaveBeenCalledWith("/funis");
  });

  it("navigates to /leads on Leads tap", () => {
    renderNav();
    fireEvent.click(screen.getByTestId("tab-leads"));
    expect(mockNavigate).toHaveBeenCalledWith("/leads");
  });

  it("navigates to /agenda on Agenda tap", () => {
    renderNav();
    fireEvent.click(screen.getByTestId("tab-agenda"));
    expect(mockNavigate).toHaveBeenCalledWith("/agenda");
  });

  // ─── Cycle 4: Desktop gate ─────────────────────────────────
  it("does NOT render when viewport is desktop", () => {
    mockViewport.mockReturnValue({ isMobile: false, isDesktop: true, width: 1280 });
    const { container } = renderNav();
    expect(container.firstChild).toBeNull();
  });

  // ─── Cycle 5: "Mais" dispatches full-nav event ─────────────
  it("dispatches v8:open-mobile-nav when Mais is tapped", () => {
    const listener = vi.fn();
    window.addEventListener("v8:open-mobile-nav", listener);

    renderNav();
    fireEvent.click(screen.getByTestId("tab-mais"));

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("v8:open-mobile-nav", listener);
  });
});
