/**
 * Trilha 3.B Fase B1 / T3B.3 — Prompt Builder (skeleton)
 *
 * Status: SKELETON — funções a mover de agent-engine.ts em sessão dedicada.
 *
 * Funções alvo (linhas em agent-engine.ts):
 *   - buildDynamicPrompt    (~ linha 1559) — monta system prompt completo
 *   - buildDynamicTools     (~ linha 2400+) — define 23 tools function-calling
 *   - resolveSystemPrompt   (helpers de personality, kanban rules, FAQs)
 *
 * Melhorias planejadas durante extração:
 *   - Truncagem auditada: warning quando prompt > 8K tokens (hoje silencioso)
 *   - Token estimation antes de enviar (logRuntime já feito em Onda 2)
 *   - Validação Zod do output antes do return
 *
 * Estimativa: 8h trabalho dedicado (mover + smoke + commit).
 */

export const MAX_PROMPT_TOKENS = 8000;
export const TOKEN_ESTIMATION_RATIO = 4; // chars per token approx

/**
 * Estima tokens de string (heuristic: 1 token ≈ 4 chars).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_ESTIMATION_RATIO);
}

/**
 * Verifica se prompt está dentro do limite seguro.
 */
export function isPromptWithinLimit(prompt: string, limit = MAX_PROMPT_TOKENS): boolean {
  return estimateTokens(prompt) <= limit;
}

// TODO: extrair buildDynamicPrompt + buildDynamicTools de agent-engine.ts
