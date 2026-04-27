import { describe, it, expect } from "vitest";
import {
  parseCustomInstructions,
  serializeCustomInstructions,
} from "../../src/lib/copilot/custom-instructions-utils";

describe("parseCustomInstructions", () => {
  it("returns empty for null", () => {
    expect(parseCustomInstructions(null)).toEqual({ dos: "", donts: "" });
  });

  it("returns empty for undefined", () => {
    expect(parseCustomInstructions(undefined)).toEqual({ dos: "", donts: "" });
  });

  it("returns empty for empty string", () => {
    expect(parseCustomInstructions("")).toEqual({ dos: "", donts: "" });
  });

  it("returns empty for whitespace", () => {
    expect(parseCustomInstructions("   ")).toEqual({ dos: "", donts: "" });
  });

  it("parses JSON format", () => {
    const raw = JSON.stringify({ dos: "Be helpful", donts: "Don't lie" });
    expect(parseCustomInstructions(raw)).toEqual({
      dos: "Be helpful",
      donts: "Don't lie",
    });
  });

  it("handles JSON with only dos", () => {
    const raw = JSON.stringify({ dos: "Be helpful" });
    expect(parseCustomInstructions(raw)).toEqual({
      dos: "Be helpful",
      donts: "",
    });
  });

  it("handles JSON with only donts", () => {
    const raw = JSON.stringify({ donts: "Don't lie" });
    expect(parseCustomInstructions(raw)).toEqual({
      dos: "",
      donts: "Don't lie",
    });
  });

  it("backward compat: plain string becomes dos", () => {
    expect(parseCustomInstructions("Always be professional")).toEqual({
      dos: "Always be professional",
      donts: "",
    });
  });

  it("backward compat: invalid JSON becomes dos", () => {
    expect(parseCustomInstructions("{invalid json")).toEqual({
      dos: "{invalid json",
      donts: "",
    });
  });

  it("handles JSON with non-string values gracefully", () => {
    const raw = JSON.stringify({ dos: 123, donts: null });
    const result = parseCustomInstructions(raw);
    expect(result.dos).toBe("");
    expect(result.donts).toBe("");
  });
});

describe("serializeCustomInstructions", () => {
  it("returns null when both empty", () => {
    expect(serializeCustomInstructions("", "")).toBeNull();
  });

  it("returns null when both whitespace", () => {
    expect(serializeCustomInstructions("   ", "   ")).toBeNull();
  });

  it("serializes to JSON", () => {
    const result = serializeCustomInstructions("Be helpful", "Don't lie");
    const parsed = JSON.parse(result!);
    expect(parsed.dos).toBe("Be helpful");
    expect(parsed.donts).toBe("Don't lie");
  });

  it("trims whitespace", () => {
    const result = serializeCustomInstructions("  hello  ", "  world  ");
    const parsed = JSON.parse(result!);
    expect(parsed.dos).toBe("hello");
    expect(parsed.donts).toBe("world");
  });

  it("returns JSON even when only dos", () => {
    const result = serializeCustomInstructions("Be kind", "");
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.dos).toBe("Be kind");
    expect(parsed.donts).toBe("");
  });

  it("roundtrip: serialize then parse", () => {
    const original = { dos: "Do this", donts: "Don't do that" };
    const serialized = serializeCustomInstructions(original.dos, original.donts);
    const parsed = parseCustomInstructions(serialized);
    expect(parsed).toEqual(original);
  });
});
