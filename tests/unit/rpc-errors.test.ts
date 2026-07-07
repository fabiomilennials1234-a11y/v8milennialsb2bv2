import { describe, it, expect } from "vitest";
import { isMissingSchemaError, isRpcAbsentError } from "@/lib/rpc-errors";

/**
 * FIX-A (code review): os overlays canônicos decidem DEGRADAR pro legado quando a
 * RPC canônica ainda não foi migrada. Essa decisão precisa ser por CÓDIGO
 * (PGRST202/42883) — nunca por substring "does not exist" — senão uma RPC canônica
 * JÁ implantada que lança um erro de runtime legítimo cujo texto contém "…does not
 * exist" (coluna errada, cast inválido) seria lida como "ausente" e o dashboard
 * degradaria em silêncio, escondendo dinheiro errado.
 */
describe("isRpcAbsentError (code-only — overlay degrade decision)", () => {
  it("treats PGRST202 (function not in schema cache) as absent", () => {
    expect(isRpcAbsentError({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
  });

  it("treats 42883 (undefined_function) as absent", () => {
    expect(isRpcAbsentError({ code: "42883", message: "function foo() does not exist" })).toBe(true);
  });

  it("does NOT treat a real runtime error as absent even when the message says 'does not exist'", () => {
    // Undefined column raised INSIDE a deployed canonical RPC — must surface, not degrade.
    expect(
      isRpcAbsentError({ code: "42703", message: 'column "sold_at" does not exist' }),
    ).toBe(false);
  });

  it("does NOT treat a generic error whose message contains 'schema cache' as absent", () => {
    expect(isRpcAbsentError({ code: "P0001", message: "stale schema cache detected" })).toBe(false);
  });

  it("does NOT treat a missing-table error (PGRST205 / 42P01) as RPC-absent", () => {
    // Table-missing is a different failure mode; the RPC-absent overlay gate is
    // strictly function-not-found, not any structural error.
    expect(isRpcAbsentError({ code: "PGRST205", message: "relation does not exist" })).toBe(false);
    expect(isRpcAbsentError({ code: "42P01", message: "relation does not exist" })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isRpcAbsentError(null)).toBe(false);
    expect(isRpcAbsentError(undefined)).toBe(false);
  });
});

describe("isMissingSchemaError (broad — legacy callers only, kept intact)", () => {
  it("still matches the broad substring cases for its other callers", () => {
    // The broad predicate remains for the LEGACY base RPCs, which genuinely can be
    // absent in dev; only the canonical overlays switched to the code-only variant.
    expect(isMissingSchemaError({ code: "", message: "column foo does not exist" })).toBe(true);
    expect(isMissingSchemaError({ code: "", message: "Could not find the function" })).toBe(true);
    expect(isMissingSchemaError({ code: "PGRST202", message: "" })).toBe(true);
  });

  it("still returns false for null", () => {
    expect(isMissingSchemaError(null)).toBe(false);
  });
});
