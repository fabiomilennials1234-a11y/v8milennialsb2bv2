import { describe, expect, it } from "vitest";
import { cardClosedAt, cardOutcome } from "./funil-card-outcome";

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

describe("cardClosedAt", () => {
  it("usa a data do desfecho do negócio quando ela vem", () => {
    expect(cardClosedAt({
      metadata: { deal_outcome_at: "2026-09-10T12:00:00Z" },
      stage_changed_at: "2026-09-20T12:00:00Z",
    })).toBe("2026-09-10T12:00:00Z");
  });

  it("sem a data do desfecho, recua para a entrada na etapa, depois no funil, depois a criação", () => {
    expect(cardClosedAt({ metadata: { deal_outcome_at: null }, stage_changed_at: "s", entered_at: "e", created_at: "c" })).toBe("s");
    expect(cardClosedAt({ metadata: {}, entered_at: "e", created_at: "c" })).toBe("e");
    expect(cardClosedAt({ metadata: null, created_at: "c" })).toBe("c");
    expect(cardClosedAt({})).toBeNull();
  });
});
