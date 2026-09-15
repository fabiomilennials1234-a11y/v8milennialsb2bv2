import { describe, expect, it } from "vitest";
import { blastOutcome } from "../../src/modules/campaigns/lib/blast-outcome";

describe("blast outcome (provider queue acceptance is not delivery)", () => {
  it("shows failure for the JC Atacado incident even with a completed plan", () => {
    expect(blastOutcome("completed", { total: 1, sent: 0, failed: 1 })).toMatchObject({
      title: "Disparo com falha", failed: true,
    });
  });
  it("does not claim successful sending before asynchronous provider results", () => {
    expect(blastOutcome("completed", { total: 1, sent: 1, failed: 0 }).title).toBe("Lotes liberados");
    expect(blastOutcome("completed", undefined).title).toBe("Lotes liberados");
  });
  it("retains mixed failures and cancellation", () => {
    expect(blastOutcome("completed", { total: 2, sent: 1, failed: 1 }).title).toBe("Disparo com falhas");
    expect(blastOutcome("cancelled", { total: 1, sent: 0, failed: 1 }).title).toBe("Disparo cancelado");
  });
});
