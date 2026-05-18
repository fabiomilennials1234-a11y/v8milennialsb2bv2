// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import { calculateScore } from "../../supabase/functions/_shared/action-handlers/calculate-score";
import { handlers } from "../../supabase/functions/_shared/action-handlers/index";

function makeInput(params: Record<string, unknown> = {}) {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params,
  };
}

describe("calculateScore — shared action handler", () => {
  it("is registered in the handlers registry as calculate_score", () => {
    expect(handlers.calculate_score).toBe(calculateScore);
  });

  it("calculates weighted average correctly and scales to 0-100", async () => {
    // [{weight:2, value:8}, {weight:1, value:4}] → (16+4)/3 = 6.67 → scaled to 66.7 → 67
    const result = await calculateScore(makeInput({
      criteria: [
        { name: "budget", weight: 2, value: 8 },
        { name: "urgency", weight: 1, value: 4 },
      ],
    }));
    expect(result.success).toBe(true);
    expect(result.message).toBe("Score: 67");
  });

  it("updates leads.qualification_score scoped by lead_id + organization_id", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "lead-1", organization_id: "org-1", qualification_score: 0 }]);

    // Spy on the chain to verify .eq calls
    const updateCalls: Array<{ table: string; data: unknown; filters: string[] }> = [];
    const originalFrom = sb.from.bind(sb);
    sb.from = (table: string) => {
      const chain = originalFrom(table);
      const originalUpdate = chain.update.bind(chain);
      chain.update = (data: unknown) => {
        const innerChain = originalUpdate(data);
        const eqFilters: string[] = [];
        const originalEq = innerChain.eq.bind(innerChain);
        innerChain.eq = (field: string, value: unknown) => {
          eqFilters.push(`${field}=${value}`);
          updateCalls.push({ table, data, filters: [...eqFilters] });
          return originalEq(field, value);
        };
        return innerChain;
      };
      return chain;
    };

    const result = await calculateScore({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        criteria: [{ name: "fit", weight: 1, value: 10 }],
      },
    });

    expect(result.success).toBe(true);
    expect(updateCalls.length).toBeGreaterThan(0);
    // Last entry has all accumulated filters
    const leadUpdate = updateCalls.filter((c) => c.table === "leads").pop();
    expect(leadUpdate).toBeDefined();
    expect(leadUpdate!.data).toMatchObject({ qualification_score: 100 });
    expect(leadUpdate!.filters).toContain("id=lead-1");
    expect(leadUpdate!.filters).toContain("organization_id=org-1");
  });

  it("clamps result to 0-100 — never goes below 0 or above 100", async () => {
    // value > 10 would exceed 100 without clamp
    const over = await calculateScore(makeInput({
      criteria: [{ name: "x", weight: 1, value: 15 }],
    }));
    expect(over.success).toBe(true);
    expect(over.message).toBe("Score: 100");

    // negative value would go below 0 without clamp
    const under = await calculateScore(makeInput({
      criteria: [{ name: "x", weight: 1, value: -5 }],
    }));
    expect(under.success).toBe(true);
    expect(under.message).toBe("Score: 0");
  });

  it("returns success with rounded integer score in message", async () => {
    // value=3, weight=1 → avg=3 → scaled=30
    // value=7, weight=3 → (3+21)/4 = 6.0 → scaled=60
    const result = await calculateScore(makeInput({
      criteria: [
        { name: "a", weight: 1, value: 3 },
        { name: "b", weight: 3, value: 7 },
      ],
    }));
    expect(result.success).toBe(true);
    expect(result.message).toBe("Score: 60");
  });

  it("returns error when criteria param is empty array", async () => {
    const result = await calculateScore(makeInput({ criteria: [] }));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when criteria param is missing", async () => {
    const result = await calculateScore(makeInput({}));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when DB update fails", async () => {
    const { sb, mockTable } = createMockSupabase();
    // Override .from to return an error on update
    const originalFrom = sb.from.bind(sb);
    sb.from = (table: string) => {
      const chain = originalFrom(table);
      if (table === "leads") {
        const originalUpdate = chain.update.bind(chain);
        chain.update = (data: unknown) => {
          const innerChain = originalUpdate(data);
          // Override the thenable to return an error
          const errorResult = { data: null, error: { code: "42501", message: "permission denied" } };
          innerChain.eq = () => innerChain;
          innerChain.then = (resolve: (v: any) => any, reject?: (e: any) => any) => {
            return Promise.resolve(errorResult).then(resolve, reject);
          };
          innerChain.catch = (reject?: (e: any) => any) => Promise.resolve(errorResult).catch(reject);
          return innerChain;
        };
      }
      return chain;
    };

    const result = await calculateScore({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        criteria: [{ name: "x", weight: 1, value: 5 }],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("permission denied");
  });
});
