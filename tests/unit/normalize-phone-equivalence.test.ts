/**
 * Equivalence guard: ensures the three phone-normalization implementations
 * produce byte-identical output for the same input.
 *
 *   - Frontend:  src/lib/normalizePhone.ts :: normalizePhone
 *   - Edge:      supabase/functions/_shared/lead-service.ts :: normalizePhoneForSearch
 *   - SQL:       public.normalize_brazilian_phone(text)  (verified separately)
 *
 * If any implementation drifts, this test fails and phone_ai_preferences
 * lookups / lead dedup break silently. The third (SQL) cannot be run inside
 * Vitest, so we assert the TS pair and trust that the SQL mirror (which
 * contains identical comments/algorithm) stays aligned when someone edits.
 */

import { describe, it, expect } from "vitest";
import "../../tests/helpers/deno-mock";
import { normalizePhone } from "../../src/lib/normalizePhone";
import { normalizePhoneForSearch } from "../../supabase/functions/_shared/lead-service";

const cases: Array<{ input: string | null | undefined; expected: string | null }> = [
  // Null / empty
  { input: null, expected: null },
  { input: undefined, expected: null },
  { input: "", expected: null },
  { input: "   ", expected: null },
  { input: "abcdefg", expected: null },

  // Canonical 11-digit mobile
  { input: "11987654321", expected: "11987654321" },

  // With +55 country code
  { input: "+5511987654321", expected: "11987654321" },
  { input: "5511987654321", expected: "11987654321" },

  // With formatting
  { input: "+55 (11) 98765-4321", expected: "11987654321" },
  { input: "11 98765-4321", expected: "11987654321" },
  { input: "(11) 98765-4321", expected: "11987654321" },

  // 10-digit mobile → 9 is added after DDD
  { input: "1198765432", expected: "11987654320".slice(0, 2) + "9" + "98765432" },
  { input: "1187654321", expected: "11987654321" },

  // Real-world incident numbers from the REALSC logs
  { input: "5522992327024", expected: "22992327024" },
  { input: "554797923447", expected: "4797923447".length === 10 ? "47" + "9" + "97923447" : "4797923447" },

  // International prefix not 55 → not stripped
  { input: "19876543210", expected: "19876543210" },
];

describe("normalize-phone equivalence", () => {
  for (const { input, expected } of cases) {
    it(`normalizePhone(${JSON.stringify(input)}) === normalizePhoneForSearch(${JSON.stringify(input)})`, () => {
      const fe = normalizePhone(input);
      const edge = normalizePhoneForSearch(input);
      expect(fe).toBe(edge);
      if (expected !== undefined) {
        expect(fe).toBe(expected);
      }
    });
  }

  it("produces 11 digits for every valid Brazilian mobile input", () => {
    const mobileInputs = [
      "+55 11 98765-4321",
      "55 11 98765-4321",
      "11 98765-4321",
      "11987654321",
      "5511987654321",
    ];
    for (const inp of mobileInputs) {
      expect(normalizePhone(inp)).toBe("11987654321");
      expect(normalizePhoneForSearch(inp)).toBe("11987654321");
    }
  });

  it("is symmetric: a normalized phone is a fixpoint", () => {
    const inputs = ["11987654321", "5511987654321", "+55 11 98765-4321"];
    for (const inp of inputs) {
      const once = normalizePhone(inp);
      const twice = normalizePhone(once);
      expect(once).toBe(twice);
    }
  });
});
