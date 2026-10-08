interface ToolCall {
  function: { name: string };
}

export function hasQuoteSimulation(toolCalls: ToolCall[] | null | undefined): boolean {
  return toolCalls?.some((tc) => tc.function.name === "generate_order_request") ?? false;
}
