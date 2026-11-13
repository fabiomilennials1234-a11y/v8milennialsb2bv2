import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { instancesToNumbers, type InstanceLike } from "@/shared/disparo/disparo-numbers";
import { createInitialState } from "@/modules/campaigns/components/disparo-wizard/wizard-machine";
import { StepSpeed } from "@/modules/campaigns/components/disparo-wizard/StepSpeed";

const now = Date.parse("2026-11-13T15:00:00Z");
const official = {
  id: "official", provider: "notificame", status: "connected",
  instance_name: "Oficial", daily_blast_cap: 1000,
  created_at: "2026-01-01T15:00:00Z",
};

function SpeedFixture({ instances = [official] }: { instances?: InstanceLike[] }) {
  const [draft, setDraft] = useState(() => ({
    ...createInitialState("2026-11-13", instancesToNumbers(instances, now)).draft,
    audienceCount: 1000,
  }));
  return <>
    <StepSpeed draft={draft} patch={(patch) => setDraft((prev) => ({ ...prev, ...patch }))} />
    {draft.numbers.map((n, index) => <output key={n.id} data-testid={index === 0 ? "submitted-cap" : `cap-${n.id}`}>{n.cap}</output>)}
  </>;
}

describe("configured official daily cap", () => {
  it("keeps the stored 1,000 cap from instance loading through the speed control", () => {
    render(<SpeedFixture />);
    expect(screen.getByTestId("submitted-cap")).toHaveTextContent("1000");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "1000");
    fireEvent.click(screen.getByRole("radio", { name: /Conservador/ }));
    expect(screen.getByTestId("submitted-cap")).toHaveTextContent("20");
    fireEvent.click(screen.getByRole("radio", { name: /Máximo/ }));
    expect(screen.getByTestId("submitted-cap")).toHaveTextContent("1000");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "1000");
    expect(screen.queryByText(/RISCO de banimento/)).not.toBeInTheDocument();
  });

  it("does not apply the new Chip ceiling to an official channel", () => {
    const [number] = instancesToNumbers([{ ...official, created_at: "2026-11-12T15:00:00Z" }], now);
    expect(number.cap).toBe(1000);
    expect(number.isNew).toBe(false);
  });

  it("bounds each number independently and resyncs the slider when selection changes", () => {
    render(<SpeedFixture instances={[
      official,
      { ...official, id: "other", instance_name: "Outro oficial", daily_blast_cap: 300 },
      { ...official, id: "chip", instance_name: "Chip", provider: "uazapi" },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: /Outro oficial/ }));
    fireEvent.click(screen.getByRole("button", { name: /Chip/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Máximo/ }));
    expect(screen.getByTestId("submitted-cap")).toHaveTextContent(/^1000$/);
    expect(screen.getByTestId("cap-other")).toHaveTextContent(/^300$/);
    expect(screen.getByTestId("cap-chip")).toHaveTextContent(/^200$/);
    fireEvent.click(screen.getByRole("button", { name: /^Oficial/ }));
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "300");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "300");
    fireEvent.click(screen.getByRole("button", { name: /Outro oficial/ }));
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "200");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "200");
  });

  it.each([null, undefined, 0, -10, NaN, Infinity])("keeps a finite fallback for an invalid stored cap (%s)", (daily_blast_cap) => {
    const [number] = instancesToNumbers([{ ...official, daily_blast_cap }], now);
    expect(number.cap).toBe(80);
    expect(number.maxCap).toBe(200);
  });

  it("keeps Chip safety limits independent of the official configuration", () => {
    const numbers = instancesToNumbers([
      official,
      { ...official, id: "chip", provider: "uazapi" },
      { ...official, id: "new-chip", provider: "uazapi", created_at: "2026-11-12T15:00:00Z" },
    ], now);
    expect(numbers.map((n) => [n.cap, n.maxCap])).toEqual([[1000, 1000], [80, 200], [20, 200]]);
  });
});
