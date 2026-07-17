import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupportRealtimeAnnouncement } from "./SupportRealtimeAnnouncement";
import { markLaunchSeen, dismissNudgeForever } from "./announcement-state";

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

describe("SupportRealtimeAnnouncement", () => {
  it("mostra o LANÇAMENTO na estreia", async () => {
    render(<SupportRealtimeAnnouncement />);
    await waitFor(() => expect(screen.getByText("LAUNCH")).toBeInTheDocument());
    expect(screen.queryByText("NUDGE")).not.toBeInTheDocument();
  });

  it("mostra o COACH-MARK depois do lançamento visto", async () => {
    markLaunchSeen();
    render(<SupportRealtimeAnnouncement />);
    await waitFor(() => expect(screen.getByText("NUDGE")).toBeInTheDocument());
    expect(screen.queryByText("LAUNCH")).not.toBeInTheDocument();
  });

  it("não mostra nada depois do X (nudge desligado)", async () => {
    markLaunchSeen();
    dismissNudgeForever();
    const { container } = render(<SupportRealtimeAnnouncement />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("LAUNCH")).not.toBeInTheDocument();
    expect(screen.queryByText("NUDGE")).not.toBeInTheDocument();
  });
});
