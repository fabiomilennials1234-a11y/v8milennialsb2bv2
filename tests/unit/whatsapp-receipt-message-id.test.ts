// @vitest-environment node
/**
 * Regressão: read receipt da Uazapi nunca casava com a mensagem gravada.
 *
 * O evento `messages` grava o id COMPOSTO (`<owner>:<ID>`); o `messages_update`
 * traz o ID NU em `event.MessageIDs[]`. O handler casava pelo nu → 0 linhas, e
 * como 0 linhas não é erro no PostgREST a falha era invisível: em 28/07/2026 o
 * prod tinha 84k eventos `messages_update` "com sucesso" em 3 dias e ZERO das
 * 1.955.029 mensagens com status `delivered`/`read`.
 *
 * Importa o módulo de produção (sem imports remotos, roda no vitest) em vez de
 * redeclarar os helpers — teste que copia o código não protege contra drift.
 */

import { describe, it, expect } from "vitest";
import {
  buildMessageIdCandidates,
  extractRawMessageIds,
  mapReceiptStatus,
} from "../../supabase/functions/whatsapp-webhook/message-id.ts";

// Payload real capturado da DLQ do prod (28/07/2026), com o número trocado.
const REAL_RECEIPT_EVENT = {
  Chat: "557381159116@s.whatsapp.net",
  Type: "Delivered",
  Sender: "557381159116@s.whatsapp.net",
  IsGroup: false,
  IsFromMe: false,
  MessageIDs: ["3EB0C8864C55796801B076"],
};

describe("buildMessageIdCandidates", () => {
  it("REGRESSÃO: id nu do receipt gera o composto que está gravado no banco", () => {
    const out = buildMessageIdCandidates(
      "A5297FB32FA1D95D9379C6A56735EC81",
      "558587240008",
    );
    expect(out).toContain("558587240008:A5297FB32FA1D95D9379C6A56735EC81");
    expect(out).toContain("A5297FB32FA1D95D9379C6A56735EC81");
  });

  it("usa owner como fallback quando a instância ainda não tem phone_number", () => {
    const out = buildMessageIdCandidates("ABC123", null, "5527997313678");
    expect(out).toContain("5527997313678:ABC123");
  });

  it("sem prefixo disponível, devolve só o id cru (não inventa chave)", () => {
    expect(buildMessageIdCandidates("ABC123", null)).toEqual(["ABC123"]);
    expect(buildMessageIdCandidates("ABC123", null, 42)).toEqual(["ABC123"]);
  });

  it("id já composto também gera o nu (caminho inverso)", () => {
    const out = buildMessageIdCandidates("558587240008:ABC123", "558587240008");
    expect(out).toContain("558587240008:ABC123");
    expect(out).toContain("ABC123");
  });

  it("não produz chave vazia quando o id termina em dois-pontos", () => {
    expect(buildMessageIdCandidates("558587240008:", "558587240008")).toEqual([
      "558587240008:",
    ]);
  });
});

describe("extractRawMessageIds", () => {
  it("REGRESSÃO: lê o ARRAY inteiro — um receipt cobre várias mensagens", () => {
    expect(extractRawMessageIds({ ids: ["A", "B", "C"] })).toEqual(["A", "B", "C"]);
  });

  it("cai para id/messageid/key.id quando não há array", () => {
    expect(extractRawMessageIds({ id: "A" })).toEqual(["A"]);
    expect(extractRawMessageIds({ messageid: "B" })).toEqual(["B"]);
    expect(extractRawMessageIds({ key: { id: "C" } })).toEqual(["C"]);
  });

  it("descarta vazio, nulo e não-string em vez de gerar chave inválida", () => {
    expect(extractRawMessageIds({ ids: ["A", "", null, 7, "B"] })).toEqual(["A", "B"]);
    expect(extractRawMessageIds({})).toEqual([]);
    expect(extractRawMessageIds({ id: "" })).toEqual([]);
  });

  it("array vazio não engole o id do nível de cima", () => {
    expect(extractRawMessageIds({ ids: [], id: "A" })).toEqual(["A"]);
  });
});

describe("mapReceiptStatus", () => {
  it("mapeia os tipos que a Uazapi manda", () => {
    expect(mapReceiptStatus("Delivered")).toBe("delivered");
    expect(mapReceiptStatus("Read")).toBe("read");
  });

  it("REGRESSÃO: Played vira read — 'played' viola o CHECK da coluna", () => {
    // whatsapp_messages_status_check aceita só
    // pending/sent/delivered/read/received/failed. Gravar 'played' daria 23514
    // em silêncio, porque o UPDATE não usa throwOnError.
    expect(mapReceiptStatus("Played")).toBe("read");
  });

  it("valor desconhecido é ignorado, nunca gravado cru", () => {
    expect(mapReceiptStatus("Whatever")).toBeUndefined();
    expect(mapReceiptStatus("deleted")).toBeUndefined();
    expect(mapReceiptStatus(undefined)).toBeUndefined();
    expect(mapReceiptStatus("")).toBeUndefined();
    expect(mapReceiptStatus(123)).toBeUndefined();
  });

  it("todo valor do mapa é aceito pelo CHECK do banco", () => {
    const permitidos = new Set([
      "pending",
      "sent",
      "delivered",
      "read",
      "received",
      "failed",
    ]);
    for (const tipo of ["Delivered", "Read", "Played", "sent", "pending", "failed", "error"]) {
      expect(permitidos.has(mapReceiptStatus(tipo)!)).toBe(true);
    }
  });
});

describe("payload real da Uazapi (ponta a ponta dos helpers)", () => {
  it("o receipt do prod resolve para a chave gravada", () => {
    const ev = REAL_RECEIPT_EVENT;
    const ids = extractRawMessageIds({ ids: ev.MessageIDs, id: ev.MessageIDs[0] });
    expect(ids).toEqual(["3EB0C8864C55796801B076"]);

    const candidatos = ids.flatMap((id) =>
      buildMessageIdCandidates(id, "558521367202"),
    );
    expect(candidatos).toContain("558521367202:3EB0C8864C55796801B076");
    expect(mapReceiptStatus(ev.Type)).toBe("delivered");
  });

  it("IsFromMe=false é o contato lendo a NOSSA mensagem (aplica em outgoing)", () => {
    // O handler só grava status quando fromMe !== true; este teste fixa a
    // semântica para que ninguém inverta o sinal depois.
    expect(REAL_RECEIPT_EVENT.IsFromMe).toBe(false);
  });
});
