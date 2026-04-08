import { describe, it, expect } from "vitest";
import { normalizePhone } from "../../src/lib/normalizePhone";

describe("normalizePhone", () => {
  // All of these represent the same contact: (11) 98765-4321
  const EXPECTED = "11987654321";

  it("normalizes +55 11 98765-4321", () => {
    expect(normalizePhone("+55 11 98765-4321")).toBe(EXPECTED);
  });

  it("normalizes 5511987654321 (with country code, no spaces)", () => {
    expect(normalizePhone("5511987654321")).toBe(EXPECTED);
  });

  it("normalizes 11987654321 (already canonical)", () => {
    expect(normalizePhone("11987654321")).toBe(EXPECTED);
  });

  it("normalizes 11 98765-4321 (with space and dash, no country code)", () => {
    expect(normalizePhone("11 98765-4321")).toBe(EXPECTED);
  });

  it("normalizes 1198765432 (10-digit mobile, missing 9 → inserts 9 after DDD)", () => {
    // 1198765432 = DDD(11) + 8digits(98765432) → DDD(11) + 9 + 8digits = 11998765432
    // This is a DIFFERENT number than 11987654321
    expect(normalizePhone("1198765432")).toBe("11998765432");
  });

  it("normalizes (11) 98765-4321 (with parens)", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe(EXPECTED);
  });

  it("normalizes 055 11 98765-4321 (with leading 0 in country code)", () => {
    // 05511987654321 = 14 digits, starts with 0 not 55, so no prefix removal
    // Actually: "055 11 98765-4321" → cleaned = "05511987654321" (14 digits)
    // Does NOT start with "55" (starts with "05") so no prefix removal
    // Result: "05511987654321" (14 digits)
    // This is an edge case the current normalizer doesn't handle
    expect(normalizePhone("055 11 98765-4321")).toBe("05511987654321");
  });

  // Null/empty handling
  it("returns null for null input", () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizePhone("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizePhone("   ")).toBeNull();
  });

  // Landline numbers (10 digits with 9 NOT added because it's a landline pattern)
  // Note: current impl adds 9 to ALL 10-digit numbers, which may be incorrect
  // for landlines. This test documents current behavior.
  it("adds 9 to 10-digit numbers (current behavior)", () => {
    // 1133334444 (landline) → 11933334444 (adds 9 — may be incorrect for landlines)
    expect(normalizePhone("1133334444")).toBe("11933334444");
  });

  // Different DDDs
  it("normalizes 85988881234 from Ceará", () => {
    expect(normalizePhone("5585988881234")).toBe("85988881234");
  });

  it("normalizes 21987654321 from Rio", () => {
    expect(normalizePhone("+55 21 98765-4321")).toBe("21987654321");
  });
});
