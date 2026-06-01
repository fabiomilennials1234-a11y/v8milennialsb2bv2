/**
 * builder-form-reducer.test.ts
 *
 * TDD for PRD #544 / Slice #547 — the pure core of the Builder's live-fill.
 * applyBuilderAction takes the current form state + an action the Builder
 * emitted and returns the next state, enforcing manually-edited field locks.
 */

import { describe, it, expect } from "vitest";
import { createDefaultPlaygroundData } from "@/modules/copilot/components/playground/types";
import {
  applyBuilderAction,
  type BuilderFormState,
} from "@/modules/copilot/lib/builder-form-reducer";

function initialState(): BuilderFormState {
  return { data: createDefaultPlaygroundData(), locked: [] };
}

describe("applyBuilderAction", () => {
  it("set_prompt_section writes text into the section", () => {
    const next = applyBuilderAction(initialState(), {
      kind: "set_prompt_section",
      section: "objective",
      text: "Qualificar leads B2B de embalagens",
    });

    expect(next.data.promptSections.objective).toBe(
      "Qualificar leads B2B de embalagens",
    );
  });

  it("enable_tool enables the tool and sets its instruction", () => {
    const next = applyBuilderAction(initialState(), {
      kind: "enable_tool",
      toolId: "AGENDAR_REUNIAO",
      instruction: "Agende quando o lead pedir.",
    });

    expect(next.data.tools.AGENDAR_REUNIAO.enabled).toBe(true);
    expect(next.data.tools.AGENDAR_REUNIAO.instruction).toBe(
      "Agende quando o lead pedir.",
    );
  });

  it("rejects enable_tool for a tool that is not in the manifest", () => {
    const state = initialState();
    const next = applyBuilderAction(state, {
      kind: "enable_tool",
      toolId: "FERRAMENTA_INVENTADA",
    });

    expect(next.data.tools.FERRAMENTA_INVENTADA).toBeUndefined();
    expect(next).toEqual(state);
  });

  it("does not overwrite a section the user has locked", () => {
    const seed = initialState();
    seed.data.promptSections.objective = "Texto que escrevi à mão";
    seed.locked = ["promptSections.objective"];

    const next = applyBuilderAction(seed, {
      kind: "set_prompt_section",
      section: "objective",
      text: "Builder tentou reescrever",
    });

    expect(next.data.promptSections.objective).toBe("Texto que escrevi à mão");
  });

  it("overwrites a locked section when override is set", () => {
    const seed = initialState();
    seed.data.promptSections.objective = "Texto que escrevi à mão";
    seed.locked = ["promptSections.objective"];

    const next = applyBuilderAction(seed, {
      kind: "set_prompt_section",
      section: "objective",
      text: "Builder com permissão",
      override: true,
    });

    expect(next.data.promptSections.objective).toBe("Builder com permissão");
  });

  it("user_edit locks the field so the Builder won't overwrite it", () => {
    let s = applyBuilderAction(initialState(), {
      kind: "user_edit",
      path: "promptSections.flow",
    });
    expect(s.locked).toContain("promptSections.flow");

    s = applyBuilderAction(s, {
      kind: "set_prompt_section",
      section: "flow",
      text: "Builder tentou",
    });
    expect(s.data.promptSections.flow).toBe("");
  });

  it("user_edit does not duplicate an already-locked path", () => {
    let s = applyBuilderAction(initialState(), {
      kind: "user_edit",
      path: "promptSections.flow",
    });
    s = applyBuilderAction(s, { kind: "user_edit", path: "promptSections.flow" });

    expect(s.locked.filter((p) => p === "promptSections.flow")).toHaveLength(1);
  });
});
