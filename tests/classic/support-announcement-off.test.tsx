import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupportAnnouncement } from "@/modules/platform/components/support/SupportAnnouncement";

vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/modules/platform/components/support/SupportPanelContext", () => ({
  useSupportPanel: () => ({ isOpen: false, open: vi.fn() }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  // Cenário em que o anúncio ligado abriria: FAB no DOM, nenhum loader na tela.
  const fab = document.createElement("button");
  fab.setAttribute("data-support-fab", "");
  document.body.appendChild(fab);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("SupportAnnouncement (desligado)", () => {
  it("não abre o modal nem o coach-mark na primeira entrada", () => {
    render(<SupportAnnouncement />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
