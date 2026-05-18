/**
 * JS↔SQL parity for canonical phone normalization.
 *
 * Invariante por construção: `src/lib/normalizePhone.ts` (JS) e
 * `public.normalize_brazilian_phone(text)` (PostgreSQL, migration
 * 20260130100000) DEVEM produzir o mesmo output para qualquer input.
 *
 * O hook `useResolveChatDeepLink` agora filtra com `eq("normalized_phone", X)`
 * onde X é calculado em JS. Se as duas implementações divergem em qualquer
 * formato comum, o resolver retorna `null` em casos que existem no banco —
 * regressão silenciosa.
 *
 * Pre-req: `supabase start` rodando localmente.
 */

import { describe, it, expect } from "vitest";
import { supabase } from "./setup";
import { normalizePhone } from "@/lib/normalizePhone";

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === "true";

const PHONE_INPUTS: ReadonlyArray<string | null> = [
  // Formatos brasileiros comuns
  "5511987654321",
  "11987654321",
  "+55 11 98765-4321",
  "(11) 98765-4321",
  "11 98765-4321",
  // 10 dígitos (precisa adicionar 9)
  "1198765432",
  "5511987654320".slice(0, 12),
  // Outros DDDs
  "5521987654321",
  "5547987654321",
  // Edge cases
  "",
  "   ",
  "abc",
  "55",
];

describe.skipIf(shouldSkip)("normalizePhone JS ↔ normalize_brazilian_phone SQL — parity", () => {
  it.each(PHONE_INPUTS)("input %j produz mesmo output em JS e SQL", async (input) => {
    const jsResult = normalizePhone(input);

    const { data: sqlResult, error } = await supabase.rpc(
      "normalize_brazilian_phone",
      { phone: input },
    );

    expect(error).toBeNull();
    expect(sqlResult).toBe(jsResult);
  });
});
