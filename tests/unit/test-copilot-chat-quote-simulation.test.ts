import { describe, expect, it } from "vitest";
import { hasQuoteSimulation } from "../../supabase/functions/test-copilot-chat/quote-simulation";

describe("test-copilot-chat quote simulation", () => {
  it("accepts an ordinary text response without tool_calls", () => {
    expect(hasQuoteSimulation(undefined)).toBe(false);
    expect(hasQuoteSimulation(null)).toBe(false);
  });

  it("detects only the quote tool", () => {
    expect(hasQuoteSimulation([])).toBe(false);
    expect(hasQuoteSimulation([{ function: { name: "search_knowledge" } }])).toBe(false);
    expect(hasQuoteSimulation([{ function: { name: "generate_order_request" } }])).toBe(true);
  });
});
