/**
 * document-delivery — a verdade de entrega carimbada no payload da ação.
 *
 * `process-ai-actions` grava `status='completed'` sempre que `result.success`
 * é true, e a supressão do dedup devolve `success:true`. Sem carimbo, entregue
 * e suprimido ficam indistinguíveis no banco — e era isso que fazia o gate se
 * alimentar das próprias supressões e o prompt afirmar ao lead um envio que
 * nunca aconteceu.
 */

import { describe, it, expect } from "vitest";
import {
  isDeliveredSend,
  sentDocumentLabel,
} from "../../supabase/functions/_shared/copilot/document-delivery.ts";

describe("isDeliveredSend", () => {
  it("entregue → true", () => {
    expect(
      isDeliveredSend({
        document_id: "doc-1",
        file_name: "Banho de Verniz - PRODUTO 1.png",
        delivered_at: "2026-09-01T14:04:08.000Z",
      }),
    ).toBe(true);
  });

  it("suprimido por duplicata → false", () => {
    expect(
      isDeliveredSend({
        document_id: "doc-1",
        suppressed_at: "2026-09-01T14:06:01.000Z",
        suppressed_reason: "duplicate_document",
      }),
    ).toBe(false);
  });

  it("suprimido por lock em voo → false", () => {
    expect(
      isDeliveredSend({
        document_id: "doc-1",
        suppressed_at: "2026-09-01T14:06:01.000Z",
        suppressed_reason: "send_lock_held",
      }),
    ).toBe(false);
  });

  it("linha ANTIGA sem carimbo → true (conservador por desenho)", () => {
    // Todas as 769 linhas `completed` que existiam em prod em 2026-09-01 caem
    // aqui. Assumir "não entregou" faria a IA reenviar material que o lead já
    // recebeu em conversas anteriores ao conserto.
    expect(isDeliveredSend({ document_id: "doc-1", caption: "Foto do produto" })).toBe(true);
  });

  it("payload ausente → true (mesma razão)", () => {
    expect(isDeliveredSend(null)).toBe(true);
    expect(isDeliveredSend(undefined)).toBe(true);
  });

  it("o carimbo de supressão vence mesmo se houver file_name na linha", () => {
    expect(
      isDeliveredSend({
        document_id: "doc-1",
        file_name: "catalogo.pdf",
        suppressed_at: "2026-09-01T14:06:01.000Z",
      }),
    ).toBe(false);
  });
});

describe("sentDocumentLabel", () => {
  it("usa o nome do arquivo quando carimbado", () => {
    expect(sentDocumentLabel({ file_name: "catalogo.pdf", document_id: "doc-1" })).toBe(
      "catalogo.pdf",
    );
  });

  it("cai no document_id quando a linha é antiga", () => {
    // Medido em prod 2026-09-01: 769 de 769 payloads NÃO tinham `file_name`,
    // então a seção "já enviados" do prompt mostrava UUID ao modelo em 100%
    // dos casos — ele não sabia nem qual arquivo teria mandado.
    expect(sentDocumentLabel({ document_id: "0afa30d8-9e9a-4981-95d8-eda2bc9208ba" })).toBe(
      "0afa30d8-9e9a-4981-95d8-eda2bc9208ba",
    );
  });

  it("devolve 'unknown' quando não há nem nome nem id", () => {
    expect(sentDocumentLabel({})).toBe("unknown");
    expect(sentDocumentLabel(null)).toBe("unknown");
  });
});
