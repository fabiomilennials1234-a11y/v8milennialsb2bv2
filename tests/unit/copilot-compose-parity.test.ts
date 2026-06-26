import { describe, it, expect } from "vitest";
import { composeSystemPrompt, type ComposeInput } from "@/modules/copilot/lib/compose-system-prompt";
import goldens from "@/modules/copilot/lib/__fixtures__/compose-goldens.json";

describe("composeSystemPrompt parity (frontend == Deno port)", () => {
  it.each(goldens as Array<{ name: string; input: ComposeInput; expected: string }>)(
    "golden $name",
    (g) => expect(composeSystemPrompt(g.input)).toBe(g.expected),
  );
});
