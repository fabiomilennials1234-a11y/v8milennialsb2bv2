/**
 * A leitura do evento `MESSAGE_STATUS`.
 *
 * Este arquivo existe por causa de um silêncio: em 19/08 a Meta recusou um áudio
 * da Chique com `131053 Media upload error`, o callback chegou 2 segundos depois
 * do envio, e o Torque o descartou. A tela seguiu dizendo "enviado" e achar a
 * causa exigiu ler `notificame_webhook_events` à mão.
 *
 * O corpo abaixo é o REAL, copiado do evento `60390bfa` em produção.
 */
import { describe, it, expect } from "vitest";

import {
  readMessageStatus,
  OUTBOUND_STATUS_RANK,
} from "../../supabase/functions/_shared/notificame-inbound.ts";

const recusaReal = {
  type: "MESSAGE_STATUS",
  channel: "whatsapp_business_account",
  messageId: "d7370d65-7893-4989-9f09-d82fa86fa542",
  contentIndex: 0,
  messageStatus: {
    code: "ERROR",
    error: {
      code: 131053,
      details:
        "Audio file uploaded with mimetype as audio/mp4, however on processing it is of type application/octet-stream. Please choose a different file.",
      message: "Media upload error",
    },
    message: "131053 - Media upload error",
    description: "The message was rejected by the provider",
  },
  subscriptionId: "d1205fbe-99c7-4744-ac6b-899cfbf03179",
};

describe("readMessageStatus", () => {
  it("lê a recusa REAL da Meta: id da mensagem, status, código e o texto", () => {
    expect(readMessageStatus(recusaReal)).toEqual({
      messageId: "d7370d65-7893-4989-9f09-d82fa86fa542",
      status: "failed",
      providerCode: "131053",
      detail:
        "Audio file uploaded with mimetype as audio/mp4, however on processing it is of type application/octet-stream. Please choose a different file.",
    });
  });

  it("o código numérico da Meta vira string sem perder o valor", () => {
    expect(readMessageStatus(recusaReal)?.providerCode).toBe("131053");
  });

  it("traduz o vocabulário do fornecedor para o do banco", () => {
    const comCodigo = (code: string) =>
      readMessageStatus({ messageId: "m1", messageStatus: { code } })?.status;

    expect(comCodigo("SENT")).toBe("sent");
    expect(comCodigo("DELIVERED")).toBe("delivered");
    expect(comCodigo("READ")).toBe("read");
    expect(comCodigo("ERROR")).toBe("failed");
    expect(comCodigo("REJECTED")).toBe("failed");
    // O CHECK do banco aceita exatamente pending|sent|delivered|read|received|failed.
    // Palavra fora do vocabulário é `null` — parka, não inventa status.
    expect(comCodigo("PROCESSING")).toBeUndefined();
  });

  it("NÃO confunde o id do EVENTO com o id da MENSAGEM", () => {
    // No corpo de `MESSAGE`, o `id` do topo é o do evento. Se ele entrasse como
    // alias, o update procuraria uma linha que nunca existiu — e a recusa
    // continuaria invisível, agora com a aparência de "não achei".
    expect(
      readMessageStatus({
        id: "id-do-evento",
        messageStatus: { code: "DELIVERED" },
      }),
    ).toBeNull();
  });

  it("sem status legível devolve null — para o handler parkar, não adivinhar", () => {
    expect(readMessageStatus({ messageId: "m1" })).toBeNull();
    expect(readMessageStatus({})).toBeNull();
  });

  it("recusa sem detalhe ainda é recusa", () => {
    expect(readMessageStatus({ messageId: "m1", messageStatus: { code: "ERROR" } })).toEqual({
      messageId: "m1",
      status: "failed",
      providerCode: null,
      detail: null,
    });
  });
});

describe("OUTBOUND_STATUS_RANK", () => {
  it("progride pending → sent → delivered → read", () => {
    expect(OUTBOUND_STATUS_RANK.pending).toBeLessThan(OUTBOUND_STATUS_RANK.sent);
    expect(OUTBOUND_STATUS_RANK.sent).toBeLessThan(OUTBOUND_STATUS_RANK.delivered);
    expect(OUTBOUND_STATUS_RANK.delivered).toBeLessThan(OUTBOUND_STATUS_RANK.read);
  });

  it("`failed` fica FORA da escala — recusa não é etapa, é desfecho", () => {
    // Se estivesse na escala, um ERROR depois de DELIVERED seria tratado como
    // rebaixamento e descartado. Foi exatamente a ordem que a Meta produziu.
    expect(OUTBOUND_STATUS_RANK.failed).toBeUndefined();
  });
});
