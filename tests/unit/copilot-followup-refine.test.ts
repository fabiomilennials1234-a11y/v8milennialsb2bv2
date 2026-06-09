/**
 * TDD: Copilot Follow-up — LLM refine prompt (#736).
 *
 * Pure prompt builder. The worker calls the LLM with this prompt to personalize
 * the Torque base text from live conversation context; the base text is the
 * deterministic fallback. Only the prompt building is pure/testable.
 *
 * Import target: supabase/functions/_shared/copilot/followup-refine.ts
 */

import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";

import { buildRefinePrompt } from "../../supabase/functions/_shared/copilot/followup-refine.ts";

describe("buildRefinePrompt", () => {
  // RED→GREEN 1 (tracer): the base text and conversation are embedded
  it("embeds the base text and recent conversation, and forbids inventing facts", () => {
    const prompt = buildRefinePrompt({
      baseText: "Oi {nome}, vamos retomar?",
      recentMessages: [
        { role: "assistant", content: "O Açaizinho cabe no seu freezer" },
        { role: "user", content: "Fico no aguardo" },
      ],
    });

    expect(prompt).toContain("Oi {nome}, vamos retomar?");
    expect(prompt).toContain("Açaizinho");
    expect(prompt.toLowerCase()).toContain("não invente");
  });

  // RED→GREEN 2 — works with no conversation history
  it("builds a valid prompt even without recent messages", () => {
    const prompt = buildRefinePrompt({ baseText: "Oi!", recentMessages: [] });
    expect(prompt).toContain("Oi!");
  });
});
