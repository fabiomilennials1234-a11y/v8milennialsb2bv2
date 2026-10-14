import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupportRealtimeAnnouncement } from "./SupportRealtimeAnnouncement";
import { markLaunchSeen, LAUNCH_KEY, NUDGE_SESSION_KEY } from "./announcement-state";

vi.mock("./SupportRealtimeLaunchModal", () => ({
  SupportRealtimeLaunchModal: () => <div>LAUNCH</div>,
}));
vi.mock("./SupportRealtimeNudge", () => ({
  SupportRealtimeNudge: () => <div>NUDGE</div>,
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// O aviso está desligado pelo kill-switch (ENABLED = false). A regra de qual aviso
// mostrar continua coberta em `announcement-state` — aqui só se prova o silêncio.
describe("SupportRealtimeAnnouncement (desligado)", () => {
  it("não mostra o LANÇAMENTO na estreia", () => {
    const { container } = render(<SupportRealtimeAnnouncement />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("LAUNCH")).not.toBeInTheDocument();
  });

  it("não mostra o COACH-MARK depois do lançamento visto", () => {
    markLaunchSeen();
    const { container } = render(<SupportRealtimeAnnouncement />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("NUDGE")).not.toBeInTheDocument();
  });

  it("não consome o storage: religar o kill-switch reabre do zero", () => {
    render(<SupportRealtimeAnnouncement />);
    expect(localStorage.getItem(LAUNCH_KEY)).toBeNull();
    expect(sessionStorage.getItem(NUDGE_SESSION_KEY)).toBeNull();
  });
});
