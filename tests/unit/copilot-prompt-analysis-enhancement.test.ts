// @vitest-environment node
/**
 * TDD tests for copilot prompt analysis enhancement.
 * Tests buildEvaluationContext and formatEvaluationContext pure functions.
 */

import { describe, it, expect } from "vitest";
import {
  buildEvaluationContext,
  formatEvaluationContext,
  type EvaluationContext,
} from "../../supabase/functions/analyze-copilot-prompt/evaluation-context";

function makeEval(overrides: Partial<Parameters<typeof buildEvaluationContext>[0][number]> = {}) {
  return {
    score_relevance: 7,
    score_tone: 8,
    score_goal_align: 6,
    score_conciseness: 7,
    score_overall: 7,
    weaknesses: "Muito genérico",
    user_message: "Qual o preço?",
    agent_response: "Vou verificar para você.",
    ...overrides,
  };
}

describe("buildEvaluationContext", () => {
  it("computes correct averages from evaluations", () => {
    const evals = [
      makeEval({ score_relevance: 8, score_tone: 6, score_goal_align: 7, score_conciseness: 9, score_overall: 7 }),
      makeEval({ score_relevance: 4, score_tone: 8, score_goal_align: 5, score_conciseness: 3, score_overall: 5 }),
      makeEval({ score_relevance: 6, score_tone: 7, score_goal_align: 6, score_conciseness: 6, score_overall: 6 }),
    ];

    const ctx = buildEvaluationContext(evals);

    expect(ctx.avgScores.relevance).toBeCloseTo(6, 1);
    expect(ctx.avgScores.tone).toBeCloseTo(7, 1);
    expect(ctx.avgScores.goalAlign).toBeCloseTo(6, 1);
    expect(ctx.avgScores.conciseness).toBeCloseTo(6, 1);
    expect(ctx.avgScores.overall).toBeCloseTo(6, 1);
  });

  it("finds top 3 weaknesses by frequency", () => {
    const evals = [
      makeEval({ weaknesses: "Muito genérico" }),
      makeEval({ weaknesses: "Muito genérico" }),
      makeEval({ weaknesses: "Muito genérico" }),
      makeEval({ weaknesses: "Sem preço" }),
      makeEval({ weaknesses: "Sem preço" }),
      makeEval({ weaknesses: "Tom informal" }),
      makeEval({ weaknesses: "Tom informal" }),
      makeEval({ weaknesses: "Resposta longa" }),
    ];

    const ctx = buildEvaluationContext(evals);

    expect(ctx.topWeaknesses).toHaveLength(3);
    expect(ctx.topWeaknesses[0]).toEqual({ text: "Muito genérico", count: 3 });
    // Second and third could be "Sem preço" or "Tom informal" (both count=2), order by first seen
    expect(ctx.topWeaknesses[1].count).toBe(2);
    expect(ctx.topWeaknesses[2].count).toBe(2);
  });

  it("picks examples with score_overall < 5", () => {
    const evals = [
      makeEval({ score_overall: 3, user_message: "Preço?", agent_response: "Não sei." }),
      makeEval({ score_overall: 7, user_message: "Oi", agent_response: "Olá!" }),
      makeEval({ score_overall: 2, user_message: "Entrega?", agent_response: "Hmm." }),
      makeEval({ score_overall: 4, user_message: "Prazo?", agent_response: "Vou ver." }),
      makeEval({ score_overall: 8, user_message: "Obrigado", agent_response: "De nada!" }),
      makeEval({ score_overall: 1, user_message: "Desconto?", agent_response: "..." }),
      makeEval({ score_overall: 4, user_message: "Estoque?", agent_response: "Talvez." }),
      makeEval({ score_overall: 3, user_message: "Garantia?", agent_response: "Sei lá." }),
    ];

    const ctx = buildEvaluationContext(evals);

    // Should pick 3-5 lowest scored examples (all with score_overall < 5)
    expect(ctx.lowScoreExamples.length).toBeGreaterThanOrEqual(3);
    expect(ctx.lowScoreExamples.length).toBeLessThanOrEqual(5);
    // All should have score < 5
    for (const ex of ctx.lowScoreExamples) {
      expect(ex.scoreOverall).toBeLessThan(5);
    }
    // Sorted by score ascending (worst first)
    for (let i = 1; i < ctx.lowScoreExamples.length; i++) {
      expect(ctx.lowScoreExamples[i].scoreOverall).toBeGreaterThanOrEqual(
        ctx.lowScoreExamples[i - 1].scoreOverall,
      );
    }
  });

  it("handles empty evaluations gracefully", () => {
    const ctx = buildEvaluationContext([]);

    expect(ctx.avgScores.relevance).toBe(0);
    expect(ctx.avgScores.tone).toBe(0);
    expect(ctx.avgScores.goalAlign).toBe(0);
    expect(ctx.avgScores.conciseness).toBe(0);
    expect(ctx.avgScores.overall).toBe(0);
    expect(ctx.topWeaknesses).toEqual([]);
    expect(ctx.lowScoreExamples).toEqual([]);
  });
});

describe("formatEvaluationContext", () => {
  it("outputs Portuguese markdown with scores", () => {
    const ctx: EvaluationContext = {
      avgScores: { relevance: 7.5, tone: 8.0, goalAlign: 6.3, conciseness: 7.0, overall: 7.2 },
      topWeaknesses: [
        { text: "Muito genérico", count: 5 },
        { text: "Sem preço", count: 3 },
      ],
      lowScoreExamples: [
        { userMessage: "Preço?", agentResponse: "Não sei.", scoreOverall: 2 },
        { userMessage: "Entrega?", agentResponse: "Hmm.", scoreOverall: 3 },
      ],
    };

    const md = formatEvaluationContext(ctx);

    // Must be in Portuguese
    expect(md).toContain("Avaliações");
    // Must contain scores
    expect(md).toContain("7.5");
    expect(md).toContain("8.0");
    expect(md).toContain("6.3");
    // Must contain weaknesses
    expect(md).toContain("Muito genérico");
    expect(md).toContain("Sem preço");
    // Must contain examples
    expect(md).toContain("Preço?");
    expect(md).toContain("Não sei.");
    // Must be markdown
    expect(md).toContain("#");
  });

  it("returns empty string for zero-data context", () => {
    const ctx: EvaluationContext = {
      avgScores: { relevance: 0, tone: 0, goalAlign: 0, conciseness: 0, overall: 0 },
      topWeaknesses: [],
      lowScoreExamples: [],
    };

    const md = formatEvaluationContext(ctx);

    // Should return empty or minimal string when no data
    expect(md).toBe("");
  });
});
