import { describe, expect, it } from "vitest";
import { cardOutcome } from "./funil-card-outcome";

describe("cardOutcome", () => {
  it("negócio ganho é ganho em qualquer etapa", () => {
    expect(cardOutcome({ metadata: { deal_outcome: "won" } }, "open")).toBe("won");
  });

  it("negócio perdido é perdido em qualquer etapa", () => {
    expect(cardOutcome({ metadata: { deal_outcome: "lost" } }, "open")).toBe("lost");
  });

  it("negócio reaberto parado na etapa de ganho ou de perda não pinta — o desfecho decide", () => {
    expect(cardOutcome({ metadata: { deal_outcome: "open" } }, "won")).toBeNull();
    expect(cardOutcome({ metadata: { deal_outcome: "open" } }, "lost")).toBeNull();
  });

  it("card sem negócio cai no papel da etapa", () => {
    expect(cardOutcome({ metadata: {} }, "won")).toBe("won");
    expect(cardOutcome({ metadata: {} }, "lost")).toBe("lost");
    expect(cardOutcome({ metadata: null }, "open")).toBeNull();
    expect(cardOutcome({}, null)).toBeNull();
  });
});
