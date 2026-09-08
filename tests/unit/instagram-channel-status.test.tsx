import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramChannelSettings } from "@/modules/platform/components/settings/InstagramChannelSettings";

const state = vi.hoisted(() => ({ status: "connected" }));
vi.mock("@/modules/communication", () => ({
  useConnectNotificame: () => ({ isConfigured: true, configReasonFor: () => null }),
  useMessagingChannels: () => ({ data: [{
    id: "instagram-channel", channel_type: "instagram", display_name: "Instagram da org",
    handle: null, status: state.status,
  }] }),
}));
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true }),
}));
vi.mock("@/modules/identity", () => ({ useIdentity: () => ({ isAdmin: true }) }));
afterEach(cleanup);

describe("Instagram connection status", () => {
  it("shows connected only for an active connection", () => {
    state.status = "connected";
    render(<InstagramChannelSettings />);
    expect(screen.getByText("Conectado")).toBeInTheDocument();
  });
  it.each(["disconnected", "error"])("does not label a %s channel as connected", (status) => {
    state.status = status;
    render(<InstagramChannelSettings />);
    expect(screen.queryByText("Conectado")).not.toBeInTheDocument();
    expect(screen.getByText(status === "disconnected" ? "Desconectado" : "Com erro")).toBeInTheDocument();
  });
});
