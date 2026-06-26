import { describe, it, expect } from "vitest";
import { composeSystemPrompt, type ComposeInput } from "./compose-system-prompt";
import goldens from "./__fixtures__/compose-goldens.json";

describe("composeSystemPrompt parity", () => {
  it.each(goldens as Array<{ name: string; input: ComposeInput; expected: string }>)(
    "golden $name",
    (g) => expect(composeSystemPrompt(g.input)).toBe(g.expected),
  );
});
