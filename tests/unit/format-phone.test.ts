/**
 * Unit tests for the BR phone display formatter (src/shared/format/phone.ts).
 */
import { describe, it, expect } from "vitest";
import { formatPhoneBR } from "../../src/shared/format/phone";

describe("formatPhoneBR", () => {
  it("formats 13-digit mobile with country code", () => {
    expect(formatPhoneBR("5548999998888")).toBe("+55 (48) 99999-8888");
  });

  it("formats 12-digit landline with country code", () => {
    expect(formatPhoneBR("554833334444")).toBe("+55 (48) 3333-4444");
  });

  it("formats 11-digit mobile without country code", () => {
    expect(formatPhoneBR("48999998888")).toBe("(48) 99999-8888");
  });

  it("formats 10-digit landline without country code", () => {
    expect(formatPhoneBR("4833334444")).toBe("(48) 3333-4444");
  });

  it("strips a WhatsApp JID suffix before formatting", () => {
    expect(formatPhoneBR("5548999998888@s.whatsapp.net")).toBe("+55 (48) 99999-8888");
  });

  it("returns empty string for null / undefined / empty", () => {
    expect(formatPhoneBR(null)).toBe("");
    expect(formatPhoneBR(undefined)).toBe("");
    expect(formatPhoneBR("")).toBe("");
  });

  it("falls back to the trimmed input for unknown lengths", () => {
    expect(formatPhoneBR("  12345  ")).toBe("12345");
  });
});
