/**
 * Pure helpers for building evaluation context from copilot_conversation_evaluations.
 * Extracted for testability — no Deno/Supabase deps.
 */

export interface EvaluationContext {
  avgScores: {
    relevance: number;
    tone: number;
    goalAlign: number;
    conciseness: number;
    overall: number;
  };
  topWeaknesses: Array<{ text: string; count: number }>;
  lowScoreExamples: Array<{
    userMessage: string;
    agentResponse: string;
    scoreOverall: number;
  }>;
}

export interface RawEvaluation {
  score_relevance: number;
  score_tone: number;
  score_goal_align: number;
  score_conciseness: number;
  score_overall: number;
  weaknesses: string;
  user_message: string;
  agent_response: string;
}

const MAX_LOW_SCORE_EXAMPLES = 5;
const MIN_LOW_SCORE_EXAMPLES = 3;
const LOW_SCORE_THRESHOLD = 5;
const TOP_WEAKNESSES_COUNT = 3;

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function buildEvaluationContext(
  evaluations: RawEvaluation[],
): EvaluationContext {
  if (evaluations.length === 0) {
    return {
      avgScores: { relevance: 0, tone: 0, goalAlign: 0, conciseness: 0, overall: 0 },
      topWeaknesses: [],
      lowScoreExamples: [],
    };
  }

  // Averages
  const avgScores = {
    relevance: avg(evaluations.map((e) => e.score_relevance)),
    tone: avg(evaluations.map((e) => e.score_tone)),
    goalAlign: avg(evaluations.map((e) => e.score_goal_align)),
    conciseness: avg(evaluations.map((e) => e.score_conciseness)),
    overall: avg(evaluations.map((e) => e.score_overall)),
  };

  // Top weaknesses by frequency
  const weaknessMap = new Map<string, number>();
  for (const e of evaluations) {
    const w = (e.weaknesses ?? "").trim();
    if (!w) continue;
    weaknessMap.set(w, (weaknessMap.get(w) ?? 0) + 1);
  }
  const topWeaknesses = Array.from(weaknessMap.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_WEAKNESSES_COUNT);

  // Low-score examples: score_overall < 5, sorted ascending (worst first), 3-5 items
  const lowScoreExamples = evaluations
    .filter((e) => e.score_overall < LOW_SCORE_THRESHOLD)
    .sort((a, b) => a.score_overall - b.score_overall)
    .slice(0, MAX_LOW_SCORE_EXAMPLES)
    .map((e) => ({
      userMessage: e.user_message,
      agentResponse: e.agent_response,
      scoreOverall: e.score_overall,
    }));

  return { avgScores, topWeaknesses, lowScoreExamples };
}

export function formatEvaluationContext(ctx: EvaluationContext): string {
  // No data = no section
  if (
    ctx.avgScores.overall === 0 &&
    ctx.topWeaknesses.length === 0 &&
    ctx.lowScoreExamples.length === 0
  ) {
    return "";
  }

  const lines: string[] = [];

  lines.push("## Avaliações Históricas de Conversas");
  lines.push("");
  lines.push("### Scores Médios (últimos 30 dias)");
  lines.push(`- Relevância: ${ctx.avgScores.relevance.toFixed(1)}`);
  lines.push(`- Tom: ${ctx.avgScores.tone.toFixed(1)}`);
  lines.push(`- Alinhamento com Objetivo: ${ctx.avgScores.goalAlign.toFixed(1)}`);
  lines.push(`- Concisão: ${ctx.avgScores.conciseness.toFixed(1)}`);
  lines.push(`- Geral: ${ctx.avgScores.overall.toFixed(1)}`);

  if (ctx.topWeaknesses.length > 0) {
    lines.push("");
    lines.push("### Fraquezas Mais Frequentes");
    for (const w of ctx.topWeaknesses) {
      lines.push(`- "${w.text}" (${w.count}x)`);
    }
  }

  if (ctx.lowScoreExamples.length > 0) {
    lines.push("");
    lines.push("### Exemplos de Baixa Performance (score < 5)");
    for (let i = 0; i < ctx.lowScoreExamples.length; i++) {
      const ex = ctx.lowScoreExamples[i];
      lines.push(`\n**Exemplo ${i + 1}** (score: ${ex.scoreOverall})`);
      lines.push(`> Usuário: ${ex.userMessage}`);
      lines.push(`> Agente: ${ex.agentResponse}`);
    }
  }

  return lines.join("\n");
}
