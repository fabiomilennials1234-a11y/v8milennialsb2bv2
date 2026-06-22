import { assertEquals } from "@std/assert";
import { extractPromptSources } from "./copilot.ts";

Deno.test("extractPromptSources — parses the 3 storage locations", () => {
  const agent = {
    system_prompt: "COMPILED PROMPT",
    custom_instructions: '{"dos":"be concise","donts":"no emoji"}', // TEXT holding JSON
    conversation_style: { promptSections: [{ id: "persona", text: "..." }] },
    prompt_hash: "abc123",
  };
  assertEquals(extractPromptSources(agent), {
    system_prompt: "COMPILED PROMPT",
    dos: "be concise",
    promptSections: [{ id: "persona", text: "..." }],
    prompt_hash: "abc123",
  });
});

Deno.test("extractPromptSources — tolerates missing/unparseable fields", () => {
  const agent = { system_prompt: null, custom_instructions: "not json", conversation_style: null };
  const out = extractPromptSources(agent);
  assertEquals(out.system_prompt, null);
  assertEquals(out.dos, null);
  assertEquals(out.promptSections, null);
  assertEquals(out.prompt_hash, null);
});
