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

// TODO: extrair OpenRouter call sites de agent-engine.ts:198, 949, 2672, 3161
