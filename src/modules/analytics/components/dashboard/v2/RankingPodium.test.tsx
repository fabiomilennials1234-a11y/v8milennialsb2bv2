import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RankingPodium } from "./RankingPodium";

const state = vi.hoisted(() => ({
  avatars: new Map<string, string>(),
}));
vi.mock("@/modules/identity", () => ({ useAvatarMap: () => state.avatars }));
vi.mock("@/modules/analytics/hooks/useDashboardMetrics", () => ({
  useRankingData: () => ({
    isLoading: false,
    data: {
      salesRanking: [
        { id: "a", name: "Ana Silva", value: 100, conversions: 1, goalProgress: 50, position: 1 },
        { id: "b", name: "Bruno Lima", value: 90, conversions: 1, goalProgress: 40, position: 2 },
        { id: "c", name: "Carla Dias", value: 80, conversions: 1, goalProgress: 30, position: 3 },
        { id: "d", name: "Diego Alves", value: 70, conversions: 1, goalProgress: 20, position: 4 },
      ],
      meetingsRanking: [
        { id: "d", name: "Diego Alves", meetings: 8, meetingsBooked: 10, goalProgress: 80, position: 1 },
      ],
    },
  }),
}));

beforeEach(() => {
  state.avatars = new Map([["a", "/ana.png"], ["b", "/broken.png"], ["d", "/diego.png"]]);
  // Radix waits for the preload image before mounting the visible <img>.
  vi.stubGlobal("Image", class extends EventTarget {
    complete = false;
    naturalWidth = 0;
    private source = "";
    get src() { return this.source; }
    set src(value: string) {
      this.source = value;
      queueMicrotask(() => {
        this.complete = true;
        this.naturalWidth = value.includes("broken") ? 0 : 100;
        this.dispatchEvent(new Event(this.naturalWidth ? "load" : "error"));
      });
    }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const range = { start: new Date("2026-10-01"), end: new Date("2026-10-31") };

describe("RankingPodium profile photos", () => {
  it("shows member photos in the podium and remaining ranking rows", async () => {
    render(<RankingPodium range={range} />);
    expect(await screen.findByRole("img", { name: "Ana Silva" })).toHaveAttribute("src", "/ana.png");
    expect(await screen.findByRole("img", { name: "Ana Silva" })).toHaveAttribute("data-podium-avatar");
    expect(await screen.findByRole("img", { name: "Diego Alves" })).toHaveAttribute("src", "/diego.png");
    expect(await screen.findByRole("img", { name: "Diego Alves" })).toHaveAttribute("data-podium-avatar");
  });

  it("keeps initials when the member has no photo or the photo fails", async () => {
    render(<RankingPodium range={range} />);
    await waitFor(() => expect(screen.getByText("BL")).toBeInTheDocument());
    expect(screen.getByText("CD")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Bruno Lima" })).not.toBeInTheDocument();
  });

  it("matches the photo by member ID when switching to meetings", async () => {
    render(<RankingPodium range={range} />);
    fireEvent.click(screen.getByRole("button", { name: "Reuniões" }));
    expect(await screen.findByRole("img", { name: "Diego Alves" })).toHaveAttribute("src", "/diego.png");
    expect(screen.queryByRole("img", { name: "Ana Silva" })).not.toBeInTheDocument();
  });
});
