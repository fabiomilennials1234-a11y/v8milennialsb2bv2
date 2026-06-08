/**
 * TDD: Copilot Follow-up — base-text composer.
 *
 * Pure logic. Resolves a Situation touch's base template against per-Lead
 * variables. This is the deterministic path / fallback; LLM refinement is a
 * later slice (#736). Guarantees no unresolved {placeholder} leaks to a Lead.
 *
 * Import target: supabase/functions/_shared/copilot/followup-compose.ts
 */

import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";

import { composeBaseText } from "../../supabase/functions/_shared/copilot/followup-compose.ts";

describe("composeBaseText", () => {
  // RED→GREEN 1 (tracer): known variables are substituted
  it("substitutes known variables case-insensitively", () => {
    const out = composeBaseText("Oi {nome}, tudo bem na {EMPRESA}?", {
      nome: "Ana",
      empresa: "Acme",
    });

    expect(out).toBe("Oi Ana, tudo bem na Acme?");
  });

  // RED→GREEN 2 — an unprovided placeholder is stripped, never leaked
  it("strips unresolved placeholders instead of leaking them", () => {
    const out = composeBaseText("Oi {nome}, sobre {ultimo_assunto}.", {
      nome: "Ana",
    });

    expect(out).not.toContain("{");
    expect(out).toBe("Oi Ana, sobre .");
  });
});
