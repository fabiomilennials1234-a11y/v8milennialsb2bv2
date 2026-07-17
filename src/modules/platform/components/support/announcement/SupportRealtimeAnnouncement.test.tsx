import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupportRealtimeAnnouncement } from "./SupportRealtimeAnnouncement";
import { markLaunchSeen, dismissNudgeForever } from "./announcement-state";

const masterAuthMock = vi.fn();
vi.mock("@/modules/identity", () => ({
  useMasterAuth: (...a: unknown[]) => masterAuthMock(...a),
}));

vi.mock("./SupportRealtimeLaunchModal", () => ({
  SupportRealtimeLaunchModal: () => <div>LAUNCH</div>,
}));
vi.mock("./SupportRealtimeNudge", () => ({
  SupportRealtimeNudge: () => <div>NUDGE</div>,
}));

const asClient = () => masterAuthMock.mockReturnValue({ isMaster: false, isLoading: false });
const asMaster = () => masterAuthMock.mockReturnValue({ isMaster: true, isLoading: false });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  masterAuthMock.mockReset();
});

describe("SupportRealtimeAnnouncement", () => {
  it("mostra o LANÇAMENTO na estreia para o cliente", async () => {
    asClient();
    render(<SupportRealtimeAnnouncement />);
    await waitFor(() => expect(screen.getByText("LAUNCH")).toBeInTheDocument());
    expect(screen.queryByText("NUDGE")).not.toBeInTheDocument();
  });

  it("mostra o COACH-MARK depois do lançamento visto", async () => {
    asClient();
    markLaunchSeen();
    render(<SupportRealtimeAnnouncement />);
    await waitFor(() => expect(screen.getByText("NUDGE")).toBeInTheDocument());
    expect(screen.queryByText("LAUNCH")).not.toBeInTheDocument();
  });

  it("não mostra nada para o master", async () => {
    asMaster();
    const { container } = render(<SupportRealtimeAnnouncement />);
    await waitFor(() => expect(masterAuthMock).toHaveBeenCalled());
    expect(screen.queryByText("LAUNCH")).not.toBeInTheDocument();
    expect(screen.queryByText("NUDGE")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("não mostra nada depois do X (nudge desligado)", async () => {
    asClient();
    markLaunchSeen();
    dismissNudgeForever();
    const { container } = render(<SupportRealtimeAnnouncement />);
    await waitFor(() => expect(masterAuthMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
