/**
 * SessionDeadBanner — render tests covering empty state + populated state.
 *
 * Mocks `useDeadSessions` (the data source) and asserts the banner self-hides
 * when no dead sessions exist and renders the alert + CTA when there are.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionDeadBanner } from "@/modules/communication/components/whatsapp/SessionDeadBanner";

const mockUseDeadSessions = vi.fn();

vi.mock("@/modules/communication/hooks/useDeadSessions", () => ({
  useDeadSessions: () => mockUseDeadSessions(),
}));

function renderBanner() {
  return render(
    <MemoryRouter>
      <SessionDeadBanner />
    </MemoryRouter>,
  );
}

describe("SessionDeadBanner", () => {
  beforeEach(() => mockUseDeadSessions.mockReset());

  it("renders nothing when there are no dead sessions", () => {
    mockUseDeadSessions.mockReturnValue({ data: [] });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while data is loading (undefined)", () => {
    mockUseDeadSessions.mockReturnValue({ data: undefined });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("shows single-instance message + CTA when one session is dead", () => {
    mockUseDeadSessions.mockReturnValue({
      data: [
        {
          id: "i1",
          instance_name: "Comercial 01",
          phone_number: "5511999999999",
          session_dead_since: "2026-05-15T10:00:00Z",
          session_dead_reason: "logged out from another device",
        },
      ],
    });

    renderBanner();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Comercial 01/)).toBeInTheDocument();
    expect(screen.getByText(/está desconectado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reparear agora/i })).toBeInTheDocument();
  });

  it("shows aggregated count when multiple sessions are dead", () => {
    mockUseDeadSessions.mockReturnValue({
      data: [
        { id: "i1", instance_name: "A", phone_number: null, session_dead_since: "x", session_dead_reason: null },
        { id: "i2", instance_name: "B", phone_number: null, session_dead_since: "x", session_dead_reason: null },
        { id: "i3", instance_name: "C", phone_number: null, session_dead_since: "x", session_dead_reason: null },
      ],
    });

    renderBanner();

    expect(screen.getByText(/3 números do WhatsApp estão desconectados/i)).toBeInTheDocument();
  });
});
