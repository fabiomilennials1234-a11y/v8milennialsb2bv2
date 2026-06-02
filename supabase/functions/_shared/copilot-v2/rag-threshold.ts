/**
 * rag-threshold — Copilot v2 single source of truth pro threshold de similaridade
 * RAG (Slice 7). A v1 espalhou 3 valores divergentes (doc 0.5/0.55/0.6); aqui
 * vive um só, ajustável num lugar. Default favorece recall (catálogo B2B); o
 * LLM-judge da Slice 5 filtra ruído downstream.
 */
export type RagKind = "doc" | "faq" | "memory";

export const RAG_THRESHOLDS: Record<RagKind, number> = {
  doc: 0.55,
  faq: 0.5,
  memory: 0.7,
};

/** Resolve o threshold por kind, aceitando um override válido em [0,1]. */
export function resolveThreshold(kind: RagKind, override?: number): number {
  if (typeof override === "number" && override >= 0 && override <= 1) return override;
  return RAG_THRESHOLDS[kind];
}
