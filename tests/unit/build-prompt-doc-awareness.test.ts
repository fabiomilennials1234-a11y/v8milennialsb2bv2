/**
 * buildSentDocumentsSection — prompt awareness for already-sent documents.
 *
 * Layer 1 of dedup: the LLM is told which docs were already sent so it
 * avoids re-sending. Pure function, no DB calls.
 */

import { describe, it, expect } from "vitest";
import { buildSentDocumentsSection } from "../../supabase/functions/agent-message/engine/build-prompt.ts";

describe("buildSentDocumentsSection", () => {
  it("lists documents when sentDocuments has items", () => {
    const result = buildSentDocumentsSection([
      { fileName: "catalogo.pdf", documentId: "doc-111" },
      { fileName: "tabela-precos.xlsx", documentId: "doc-222" },
    ]);

    expect(result).toContain("Documentos já entregues nesta conversa");
    expect(result).toContain("catalogo.pdf");
    expect(result).toContain("doc-111");
    expect(result).toContain("tabela-precos.xlsx");
    expect(result).toContain("doc-222");
    // Continua desencorajando reenvio gratuito — esse era o propósito original.
    expect(result).toContain("não os mande de novo sem motivo");
  });

  it("manda REENVIAR quando o lead diz que não recebeu (era o inverso)", () => {
    // A redação anterior — "confirme que já enviou" + "Não reenvie os mesmos
    // documentos" — era montada a partir de `status='completed'`, que incluía
    // os envios engolidos pelo dedup. O modelo ficava instruído a insistir com
    // o lead que mandou um arquivo que nunca saiu, e proibido de corrigir.
    // Medido em prod 2026-09-01: 20 leads disseram "não chegou" e em 12 o
    // agente nem tentou de novo.
    const result = buildSentDocumentsSection([
      { fileName: "catalogo.pdf", documentId: "doc-111" },
    ]);

    expect(result).toContain("reenvie na hora");
    expect(result).not.toContain("confirme que já enviou");
    expect(result).not.toContain("Não reenvie os mesmos documentos");
  });

  it("returns empty string when sentDocuments is empty", () => {
    const result = buildSentDocumentsSection([]);
    expect(result).toBe("");
  });

  it("returns empty string when sentDocuments is undefined", () => {
    const result = buildSentDocumentsSection(undefined);
    expect(result).toBe("");
  });
});
