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

    expect(result).toContain("Documentos já enviados nesta conversa");
    expect(result).toContain("catalogo.pdf");
    expect(result).toContain("doc-111");
    expect(result).toContain("tabela-precos.xlsx");
    expect(result).toContain("doc-222");
    expect(result).toContain("Não reenvie os mesmos documentos");
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
