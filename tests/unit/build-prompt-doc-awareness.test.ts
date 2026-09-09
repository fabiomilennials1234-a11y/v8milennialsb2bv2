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
    // Vale só para arquivo que NINGUÉM pediu; pedido do lead tem precedência.
    expect(result).toContain("não repita arquivo que ninguém pediu");
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

    expect(result).toContain("CHAME `send_document` na hora");
    expect(result).not.toContain("confirme que já enviou");
    expect(result).not.toContain("Não reenvie os mesmos documentos");
  });

  // 2026-09-03 — a instrução tem de abrir pela AUTORIZAÇÃO, não pela proibição.
  //
  // O runtime não trava mais reenvio (o gate vitalício de `send-document.ts`
  // virou telemetria), então esta seção é a última coisa entre o pedido do lead
  // e o arquivo. Com a proibição vindo primeiro, o modelo parava nela e
  // respondia com texto — foi o que a Forever Bella viu em 02/09: 4 pedidos, 4
  // anúncios, nenhuma foto.
  it("autoriza o reenvio ANTES de restringir — a ordem das frases importa", () => {
    const result = buildSentDocumentsSection([
      { fileName: "catalogo.pdf", documentId: "doc-111" },
    ]);

    const autoriza = result.indexOf("CHAME `send_document` na hora");
    const restringe = result.indexOf("não repita arquivo que ninguém pediu");

    expect(autoriza).toBeGreaterThan(-1);
    expect(restringe).toBeGreaterThan(-1);
    expect(autoriza).toBeLessThan(restringe);
    // "pedir de novo" precisa estar nomeado como motivo suficiente, senão o
    // modelo só reenvia quando o lead usa a palavra "não recebi".
    expect(result).toContain("pedir de novo já é motivo suficiente");
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
