import { describe, expect, it } from "vitest";
import { isWonCard } from "./funil-card-outcome";

describe("isWonCard", () => {
  it("negócio ganho é ganho em qualquer etapa", () => {
    expect(isWonCard({ metadata: { deal_outcome: "won" } }, "open")).toBe(true);
  });

  it("negócio reaberto parado na etapa de ganho NÃO é ganho — o desfecho decide", () => {
    expect(isWonCard({ metadata: { deal_outcome: "open" } }, "won")).toBe(false);
  });

  it("negócio perdido não é ganho", () => {
    expect(isWonCard({ metadata: { deal_outcome: "lost" } }, "open")).toBe(false);
  });

  it("card sem negócio cai no papel da etapa", () => {
    expect(isWonCard({ metadata: {} }, "won")).toBe(true);
    expect(isWonCard({ metadata: null }, "open")).toBe(false);
    expect(isWonCard({}, null)).toBe(false);
  });
});
