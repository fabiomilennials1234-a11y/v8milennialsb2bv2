import { describe, it, expect } from "vitest";
import {
  parseSaleValue,
  hasUsableSaleValue,
  isWonStageKey,
  shouldPromptForSaleValue,
  type WonStageResolvable,
} from "@/modules/pipelines/lib/sale-value-guard";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Governed board: default 'vendido' carries stage_role='won' (#990).
const governed: WonStageResolvable[] = [
  { stage_key: "proposta_enviada", stage_role: "open", is_final_positive: false },
  { stage_key: "vendido", stage_role: "won", is_final_positive: true },
  { stage_key: "perdido", stage_role: "lost", is_final_positive: false },
];

// Renamed/custom won stage — R2: must resolve via role, not the string.
const renamedWon: WonStageResolvable[] = [
  { stage_key: "fechado_ganho", stage_role: "won", is_final_positive: true },
  { stage_key: "negociando", stage_role: "open", is_final_positive: false },
];

// Pre-governance: default vendido not yet classified (role 'open') but flagged.
const ungoverned: WonStageResolvable[] = [
  { stage_key: "vendido", stage_role: "open", is_final_positive: true },
];

describe("parseSaleValue", () => {
  it("returns null for empty / missing", () => {
    expect(parseSaleValue(null)).toBeNull();
    expect(parseSaleValue(undefined)).toBeNull();
    expect(parseSaleValue("")).toBeNull();
  });
  it("returns null for zero / negative", () => {
    expect(parseSaleValue(0)).toBeNull();
    expect(parseSaleValue(-10)).toBeNull();
    expect(parseSaleValue("0")).toBeNull();
  });
  it("parses positive numbers and numeric strings", () => {
    expect(parseSaleValue(2000)).toBe(2000);
    expect(parseSaleValue("1500.5")).toBe(1500.5);
  });
});

describe("hasUsableSaleValue", () => {
  it("mirrors parseSaleValue positivity", () => {
    expect(hasUsableSaleValue(2500)).toBe(true);
    expect(hasUsableSaleValue(null)).toBe(false);
    expect(hasUsableSaleValue(0)).toBe(false);
  });
});

describe("isWonStageKey", () => {
  it("resolves the governed won role", () => {
    expect(isWonStageKey("vendido", governed)).toBe(true);
    expect(isWonStageKey("proposta_enviada", governed)).toBe(false);
    expect(isWonStageKey("perdido", governed)).toBe(false);
  });
  it("resolves a renamed won stage by role, not by string (R2)", () => {
    expect(isWonStageKey("fechado_ganho", renamedWon)).toBe(true);
    expect(isWonStageKey("negociando", renamedWon)).toBe(false);
    // The literal 'vendido' is NOT won on a board that renamed it.
    expect(isWonStageKey("vendido", renamedWon)).toBe(false);
  });
  it("bridges ungoverned final-positive stages", () => {
    expect(isWonStageKey("vendido", ungoverned)).toBe(true);
  });
  it("falls back to the legacy key when stages are unavailable", () => {
    expect(isWonStageKey("vendido", [])).toBe(true);
    expect(isWonStageKey("vendido", undefined)).toBe(true);
    expect(isWonStageKey("proposta_enviada", [])).toBe(false);
  });
});

describe("shouldPromptForSaleValue", () => {
  it("prompts on a won move without a usable value", () => {
    expect(shouldPromptForSaleValue("vendido", null, governed)).toBe(true);
    expect(shouldPromptForSaleValue("vendido", 0, governed)).toBe(true);
    expect(shouldPromptForSaleValue("fechado_ganho", undefined, renamedWon)).toBe(true);
  });
  it("does NOT prompt when the won move already carries a value", () => {
    expect(shouldPromptForSaleValue("vendido", 5000, governed)).toBe(false);
    expect(shouldPromptForSaleValue("vendido", "1200", governed)).toBe(false);
  });
  it("never prompts on non-won moves", () => {
    expect(shouldPromptForSaleValue("proposta_enviada", null, governed)).toBe(false);
    expect(shouldPromptForSaleValue("perdido", null, governed)).toBe(false);
    expect(shouldPromptForSaleValue("negociando", null, renamedWon)).toBe(false);
  });
});
