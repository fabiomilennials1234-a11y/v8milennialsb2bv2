/**
 * Trilha 3.B Fase B1 / T3B.4 — LLM Client (skeleton)
 *
 * Status: SKELETON — wrapper sobre OpenRouterClient existente.
 *
 * Plano:
 *   - Encapsular this.openRouter.chat() com:
 *     * timeout (30s default — alinhado com Onda 1 P1.3)
 *     * retry exponencial 1x em erro 5xx OpenRouter
 *     * token tracking integrado (já feito em Onda 2 inline)
 *     * model fallback se primary falha (gemini-2.5-flash → gemini-1.5-pro)
 *
 * Estimativa: 4h.
 */

export const LLM_DEFAULT_TIMEOUT_MS = 30_000;
export const LLM_RETRY_DELAYS_MS = [1_000, 3_000];

export interface LlmCallResult {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
  durationMs: number;
}

// ─── Timing helpers (extracted timing pattern from Onda 2 instrumentation) ───

/**
 * Mede latência de chamada LLM. Use:
 *   const t = startTimer();
 *   const response = await openRouter.chat(...);
 *   const ms = t.elapsed();
 */
export function startTimer(): { elapsed: () => number } {
  const start = Date.now();
  return { elapsed: () => Date.now() - start };
}

/**
 * Extrai usage tokens de response OpenRouter de forma defensiva.
 * Retorna null se shape inválido.
 */
export function extractTokenUsage(response: unknown): { prompt: number; completion: number; total: number } | null {
  const r = response as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } } | null;
  const u = r?.usage;
  if (!u || typeof u.prompt_tokens !== "number" || typeof u.completion_tokens !== "number") return null;
  return {
    prompt: u.prompt_tokens,
    completion: u.completion_tokens,
    total: u.total_tokens ?? u.prompt_tokens + u.completion_tokens,
  };
}

/**
 * Wrapper genérico com timeout pra qualquer Promise.
 * Útil pra envolver openRouter.chat() com hard limit.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = "LLM call timeout",
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${errorMessage} after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([promise, timeoutPromise]);
}
