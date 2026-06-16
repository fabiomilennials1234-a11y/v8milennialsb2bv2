import { describe, it, expect } from "vitest";
import { maskCurrencyInput, parseCurrencyInput } from "@/lib/format";

describe("maskCurrencyInput", () => {
  it("returns empty string for empty / non-digit input", () => {
    expect(maskCurrencyInput("")).toBe("");
    expect(maskCurrencyInput("abc")).toBe("");
    expect(maskCurrencyInput("R$ ,.")).toBe("");
  });

  it("treats typed digits as cents from the right", () => {
    expect(maskCurrencyInput("5")).toBe("0,05");
    expect(maskCurrencyInput("12")).toBe("0,12");
    expect(maskCurrencyInput("123")).toBe("1,23");
    expect(maskCurrencyInput("12345")).toBe("123,45");
  });

  it("groups thousands with a dot", () => {
    expect(maskCurrencyInput("100000")).toBe("1.000,00");
    expect(maskCurrencyInput("1234567")).toBe("12.345,67");
    expect(maskCurrencyInput("123456789")).toBe("1.234.567,89");
  });

  it("strips formatting already present in the input", () => {
    expect(maskCurrencyInput("1.234,56")).toBe("1.234,56");
    expect(maskCurrencyInput("R$ 12,34")).toBe("12,34");
  });

  it("drops leading zeros", () => {
    expect(maskCurrencyInput("000123")).toBe("1,23");
    expect(maskCurrencyInput("0")).toBe("");
  });
});

describe("parseCurrencyInput", () => {
  it("returns 0 for empty / non-numeric input", () => {
    expect(parseCurrencyInput("")).toBe(0);
    expect(parseCurrencyInput("abc")).toBe(0);
  });

  it("parses pt-BR masked strings into numbers", () => {
    expect(parseCurrencyInput("0,05")).toBe(0.05);
    expect(parseCurrencyInput("123,45")).toBe(123.45);
    expect(parseCurrencyInput("1.000,00")).toBe(1000);
    expect(parseCurrencyInput("1.234,56")).toBe(1234.56);
  });
});

describe("mask/parse round-trip", () => {
  it("parse(mask(x)) is stable for representative inputs", () => {
    const cases: Array<[string, number]> = [
      ["5", 0.05],
      ["12345", 123.45],
      ["100000", 1000],
      ["1234567", 12345.67],
    ];
    for (const [raw, expected] of cases) {
      expect(parseCurrencyInput(maskCurrencyInput(raw))).toBe(expected);
    }
  });
});
