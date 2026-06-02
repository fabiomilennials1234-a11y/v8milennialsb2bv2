/**
 * ingestion — Copilot v2 KB ingestion decision core (Slice 7, PURE).
 *
 * Sem I/O. Decide (a) qual extrator usar por source_kind/mime e (b) a transição
 * de status determinística do registro de conhecimento. INVARIANTE: a ingestão
 * SEMPRE sai de 'ingesting' — sucesso -> 'ready', qualquer falha -> 'failed'
 * com error_message. Nunca fica presa (lição do incidente VitrineVET 2026-06-01).
 */

import { chunkText } from "../embeddings.ts";

export type Extractor = "multimodal_text" | "docx_text" | "multimodal_ocr" | "transcript";

const DOCX_MIMES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function decideIngestionExtractor(
  sourceKind: "pdf" | "doc" | "image" | "video",
  mime: string,
): Extractor {
  if (sourceKind === "image") return "multimodal_ocr";
  if (sourceKind === "video") return "transcript";
  if (sourceKind === "doc" && DOCX_MIMES.has(mime)) return "docx_text";
  return "multimodal_text"; // pdf + doc genérico
}

export interface IngestionOutcome {
  chunksStored: number;
  /** mensagem de erro determinística, ou null no sucesso */
  error: string | null;
}

export function nextIngestionStatus(
  outcome: IngestionOutcome,
): { status: "ready" | "failed"; error_message: string | null } {
  if (outcome.error) return { status: "failed", error_message: outcome.error };
  if (outcome.chunksStored > 0) return { status: "ready", error_message: null };
  // zero chunks sem erro explícito → ainda é falha (fail-CLOSED, nunca 'ready' vazio)
  return { status: "failed", error_message: "ingestão produziu 0 chunks" };
}

/** Re-export do chunker compartilhado (1800 char, overlap 50) pra a edge fn. */
export function chunkForEmbedding(text: string): string[] {
  return chunkText(text);
}
