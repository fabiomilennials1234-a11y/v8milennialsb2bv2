/**
 * Unit tests — OptimisticLockConflictError + isPostgrestNoRows (Issue #307).
 */
import { describe, it, expect } from "vitest";
import { OptimisticLockConflictError, isPostgrestNoRows } from "@/lib/optimistic-lock";

describe("OptimisticLockConflictError", () => {
  it("carries a stable code and is instanceof Error", () => {
    const err = new OptimisticLockConflictError();
    expect(err.code).toBe("OPTIMISTIC_LOCK_CONFLICT");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("OptimisticLockConflictError");
  });

  it("accepts a custom message", () => {
    const err = new OptimisticLockConflictError("custom");
    expect(err.message).toBe("custom");
  });
});

describe("isPostgrestNoRows", () => {
  it("returns true for PGRST116 (single row not found)", () => {
    expect(isPostgrestNoRows({ code: "PGRST116" })).toBe(true);
  });

  it("returns true when details mention '0 rows'", () => {
    expect(
      isPostgrestNoRows({ code: "OTHER", details: "Results contain 0 rows" }),
    ).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isPostgrestNoRows({ code: "23505" })).toBe(false);
    expect(isPostgrestNoRows(null)).toBe(false);
    expect(isPostgrestNoRows(undefined)).toBe(false);
    expect(isPostgrestNoRows("oops")).toBe(false);
  });
});
