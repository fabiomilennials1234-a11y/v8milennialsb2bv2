/**
 * Trilha 3.B Fase B1 / T3B.7a — Search Knowledge (skeleton)
 *
 * Status: SKELETON — execução SEARCH_KNOWLEDGE inline (multi-turn LLM).
 *
 * Funções alvo:
 *   - executeSearchKnowledge (linha 799) — busca semântica em FAQs + docs
 *   - Loop multi-turn (linhas 168-221) — já tem MAX_TOOL_TURNS=3 (Onda 1 fix)
 *
 * Estimativa: 3h.
 */

export const MAX_SEARCH_KNOWLEDGE_ITERATIONS = 3;
export const FAQ_SIMILARITY_THRESHOLD = 0.65;
export const DOC_SIMILARITY_THRESHOLD = 0.6;
export const FAQ_RESULT_LIMIT = 3;
export const DOC_RESULT_LIMIT = 5;

// TODO: extrair executeSearchKnowledge de agent-engine.ts
