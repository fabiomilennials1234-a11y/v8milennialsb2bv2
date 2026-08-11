import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.0";
import { fromProviderAmount, formatCentsBRL, toProviderAmount } from "./money.ts";

// The domain carries money as integer cents. Providers speak decimal reais.
// Every float that reaches a charge is a rounding bug waiting to bill the wrong value.

Deno.test("toProviderAmount — cents become decimal reais", () => {
  assertEquals(toProviderAmount(199700), 1997);
  assertEquals(toProviderAmount(218960), 2189.6);
  assertEquals(toProviderAmount(348500), 3485);
  assertEquals(toProviderAmount(1), 0.01);
  assertEquals(toProviderAmount(0), 0);
});

Deno.test("fromProviderAmount — decimal reais become cents without float drift", () => {
  assertEquals(fromProviderAmount(2189.6), 218960);
  assertEquals(fromProviderAmount(1997), 199700);
  assertEquals(fromProviderAmount(0.07), 7);
  // 3 * 0.29 is 0.8699999999999999 in IEEE 754 — must still land on 87 cents.
  assertEquals(fromProviderAmount(3 * 0.29), 87);
});

Deno.test("money — round trips through the provider boundary", () => {
  for (const cents of [1, 99, 100, 12345, 199700, 218960, 348500, 999999999]) {
    assertEquals(fromProviderAmount(toProviderAmount(cents)), cents);
  }
});

Deno.test("toProviderAmount — rejects non-integer cents", () => {
  assertThrows(() => toProviderAmount(10.5), Error, "integer");
});

Deno.test("toProviderAmount — rejects negative amounts", () => {
  assertThrows(() => toProviderAmount(-1), Error, "negative");
});

Deno.test("toProviderAmount — rejects NaN and Infinity", () => {
  assertThrows(() => toProviderAmount(NaN), Error);
  assertThrows(() => toProviderAmount(Infinity), Error);
});

Deno.test("fromProviderAmount — rejects values that are not finite numbers", () => {
  assertThrows(() => fromProviderAmount(NaN), Error);
  assertThrows(() => fromProviderAmount(Infinity), Error);
});

Deno.test("formatCentsBRL — renders pt-BR currency from cents", () => {
  // Non-breaking space is what Intl emits between symbol and digits.
  assertEquals(formatCentsBRL(199700).replace(/\u00A0/g, " "), "R$ 1.997,00");
  assertEquals(formatCentsBRL(218960).replace(/\u00A0/g, " "), "R$ 2.189,60");
  assertEquals(formatCentsBRL(0).replace(/\u00A0/g, " "), "R$ 0,00");
});
