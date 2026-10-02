import type { ToolResult } from "./types.ts";

/** The text of a result's content block — throws when that block is not text. */
export function textOf(result: ToolResult, index = 0): string {
  const block = result.content[index];
  if (block?.type !== "text") throw new Error(`content[${index}] is not a text block`);
  return block.text;
}
