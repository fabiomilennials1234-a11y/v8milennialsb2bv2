import { assertEquals } from "@std/assert";
import { normalizeBrazilianPhone } from "./phone.ts";

// Golden parity with public.normalize_brazilian_phone
// (supabase/migrations/20260130100000_lead_phone_centralization.sql:8-42).
Deno.test("normalizeBrazilianPhone — golden parity with the DB function", () => {
  const cases: Array<[string | null | undefined, string | null]> = [
    [null, null],
    [undefined, null],
    ["", null],
    ["()-  ", null], // no digits → null
    ["11999998888", "11999998888"], // already 11 digits → unchanged
    ["1199998888", "11999998888"], // 10 digits → insert mobile 9 after DDD
    ["(11) 9999-8888", "11999998888"], // formatted 10 → normalized
    ["+55 11 99999-8888", "11999998888"], // +55 prefix dropped, then 11 digits
    ["5511999998888", "11999998888"], // 13 digits with 55 → drop → 11
    ["551199998888", "11999998888"], // 12 digits with 55 → drop → 10 → insert 9
    ["5511", "5511"], // <12 so 55 NOT stripped; not 10 → unchanged
  ];
  for (const [input, expected] of cases) {
    assertEquals(normalizeBrazilianPhone(input), expected, `input=${JSON.stringify(input)}`);
  }
});
