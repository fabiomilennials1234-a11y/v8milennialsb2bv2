import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsWidgetGrid } from "./MetricsWidgetGrid";

const values = { revenue: 128450, leads: 384, ticket: 8420, proposals: 56, conversion: 18.4, response: 12 };
beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
    clear: () => stored.clear(),
    key: (index: number) => [...stored.keys()][index] ?? null,
    get length() { return stored.size; },
  } satisfies Storage);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1000, height: 164, left: 0, top: 0, right: 1000, bottom: 164, x: 0, y: 0, toJSON() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("MetricsWidgetGrid", () => {
  it("enables keyboard ordering only while editing and persists IDs, not metric values", () => {
    render(<MetricsWidgetGrid values={values} storageKey="org-a:user-a" />);
    const revenue = screen.getByRole("listitem", { name: "Receita do Mês" });
    fireEvent.keyDown(revenue, { altKey: true, key: "ArrowRight" });
    expect(localStorage.getItem("org-a:user-a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Organizar widgets" }));
    fireEvent.keyDown(revenue, { altKey: true, key: "ArrowRight" });
    const saved = JSON.parse(localStorage.getItem("org-a:user-a")!);
    expect(saved).toHaveLength(6);
    expect(saved[0]).not.toBe("revenue");
    expect(saved).toContain("revenue");
    fireEvent.click(screen.getByRole("button", { name: "Restaurar" }));
    expect(JSON.parse(localStorage.getItem("org-a:user-a")!)[0]).toBe("revenue");
  });

  it("isolates layout when organization changes and rejects invalid stored layouts", () => {
    localStorage.setItem("org-a", JSON.stringify(["response", "leads", "ticket", "proposals", "conversion", "revenue"]));
    localStorage.setItem("org-b", JSON.stringify(["injected"]));
    const { rerender } = render(<MetricsWidgetGrid values={values} storageKey="org-a" />);
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-widget-id", "response");
    rerender(<MetricsWidgetGrid values={values} storageKey="org-b" />);
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-widget-id", "revenue");
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("uses one column on narrow screens and refreshes displayed data", () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ width: 320 } as DOMRect);
    const { container, rerender } = render(<MetricsWidgetGrid values={values} />);
    expect(container.querySelector('[data-slot="widget-grid"]')).toHaveStyle({ gridTemplateColumns: "repeat(1, minmax(0, 1fr))" });
    rerender(<MetricsWidgetGrid values={{ ...values, leads: 999 }} />);
    expect(screen.getByText("999")).toBeInTheDocument();
  });
});
