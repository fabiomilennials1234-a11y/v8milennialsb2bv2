import { describe, it, expect } from "vitest";
import { getErrorMessage } from "@/shared/errors";

describe("getErrorMessage", () => {
  it("returns the message of a native Error", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a trimmed string as-is", () => {
    expect(getErrorMessage("  plain failure  ")).toBe("plain failure");
  });

  it("extracts message from a Supabase PostgrestError", () => {
    const pgError = {
      message: "new row violates row-level security policy",
      details: null,
      hint: null,
      code: "42501",
    };
    expect(getErrorMessage(pgError)).toBe(
      "new row violates row-level security policy (42501)",
    );
  });

  it("concatenates message + details + hint when present", () => {
    const pgError = {
      message: "insert or update on table violates foreign key constraint",
      details: 'Key (assigned_to)=(x) is not present in table "team_members".',
      hint: "Check the assigned user.",
      code: "23503",
    };
    expect(getErrorMessage(pgError)).toBe(
      'insert or update on table violates foreign key constraint — Key (assigned_to)=(x) is not present in table "team_members". — Check the assigned user. (23503)',
    );
  });

  it("does not duplicate details when equal to message", () => {
    const pgError = { message: "same", details: "same", code: "P0001" };
    expect(getErrorMessage(pgError)).toBe("same (P0001)");
  });

  it("falls back to JSON for an unrecognized object shape", () => {
    expect(getErrorMessage({ weird: true })).toBe('{"weird":true}');
  });

  it("handles null/undefined gracefully", () => {
    expect(getErrorMessage(null)).toBe("Erro desconhecido");
    expect(getErrorMessage(undefined)).toBe("Erro desconhecido");
  });

  it("handles empty string as unknown", () => {
    expect(getErrorMessage("   ")).toBe("Erro desconhecido");
  });

  it("survives a circular object without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => getErrorMessage(circular)).not.toThrow();
    expect(typeof getErrorMessage(circular)).toBe("string");
  });
});
