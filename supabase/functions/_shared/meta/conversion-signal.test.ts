import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { planConversionSignal } from "./conversion-signal.ts";

Deno.test("planConversionSignal — sends when lead has meta_lead_id and event not yet sent", () => {
  const plan = planConversionSignal({
    metaLeadId: "lead_b",
    eventName: "sold",
    alreadySentEvents: new Set(["qualified"]),
  });
  assertEquals(plan.send, true);
});

Deno.test("planConversionSignal — skips when lead has no meta_lead_id (no join key)", () => {
  const plan = planConversionSignal({
    metaLeadId: null,
    eventName: "qualified",
    alreadySentEvents: new Set(),
  });
  assertEquals(plan.send, false);
  assertEquals(plan.reason, "no_meta_lead_id");
});

Deno.test("planConversionSignal — skips when event already sent (idempotent 1x/lead)", () => {
  const plan = planConversionSignal({
    metaLeadId: "lead_b",
    eventName: "qualified",
    alreadySentEvents: new Set(["qualified"]),
  });
  assertEquals(plan.send, false);
  assertEquals(plan.reason, "already_sent");
});
