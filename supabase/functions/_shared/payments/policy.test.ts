import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.0";
import {
  allowedCyclesFor,
  assertCycleAllowedForMethod,
  isCycleAllowedForMethod,
} from "./policy.ts";

// Decision locked on map #1376: PIX has no true automatic recurrence in Brazil, so it is
// sold only on long cycles. Monthly is credit-card only. This is commercial policy, and it
// lives in one testable place so no caller can quietly break it.

Deno.test("credit card — every cycle is allowed", () => {
  assertEquals(isCycleAllowedForMethod("credit_card", "monthly"), true);
  assertEquals(isCycleAllowedForMethod("credit_card", "semiannual"), true);
  assertEquals(isCycleAllowedForMethod("credit_card", "annual"), true);
});

Deno.test("pix — long cycles only", () => {
  assertEquals(isCycleAllowedForMethod("pix", "semiannual"), true);
  assertEquals(isCycleAllowedForMethod("pix", "annual"), true);
});

Deno.test("pix — monthly is refused", () => {
  assertEquals(isCycleAllowedForMethod("pix", "monthly"), false);
});

Deno.test("assertCycleAllowedForMethod — throws for pix monthly, naming both sides", () => {
  const err = assertThrows(
    () => assertCycleAllowedForMethod("pix", "monthly"),
    Error,
  );
  const message = (err as Error).message;
  assertEquals(message.includes("pix"), true);
  assertEquals(message.includes("monthly"), true);
});

Deno.test("assertCycleAllowedForMethod — passes silently for allowed pairs", () => {
  assertCycleAllowedForMethod("pix", "annual");
  assertCycleAllowedForMethod("credit_card", "monthly");
});

Deno.test("allowedCyclesFor — drives the UI without duplicating the rule", () => {
  assertEquals(allowedCyclesFor("pix"), ["semiannual", "annual"]);
  assertEquals(allowedCyclesFor("credit_card"), ["monthly", "semiannual", "annual"]);
});
