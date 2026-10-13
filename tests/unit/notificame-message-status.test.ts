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
  mesclarStatusNaLinha,
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
      providerMessageId: null,
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

  it("lê o providerMessageId — a ÚNICA chave estável entre callbacks", () => {
    // Medido em prod: SENT e ERROR da mesma mensagem chegaram com `messageId`
    // DIFERENTES e este campo IDÊNTICO. Casar pelo `messageId` fez a recusa não
    // achar linha nenhuma.
    const lido = readMessageStatus({
      ...recusaReal,
      messageStatus: { ...recusaReal.messageStatus, providerMessageId: "U2hTM01Z==" },
    });
    expect(lido?.providerMessageId).toBe("U2hTM01Z==");
  });

  it("sem status legível devolve null — para o handler parkar, não adivinhar", () => {
    expect(readMessageStatus({ messageId: "m1" })).toBeNull();
    expect(readMessageStatus({})).toBeNull();
  });

  it("recusa sem detalhe ainda é recusa", () => {
    expect(readMessageStatus({ messageId: "m1", messageStatus: { code: "ERROR" } })).toEqual({
      messageId: "m1",
      providerMessageId: null,
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

/**
 * A MESCLA de um callback na linha — os dois defeitos de 13/10.
 *
 * Sampaio e Moraes: seis recusas gravadas com `detail` e `provider_code` nulos,
 * e a vendedora vendo só "falhou". Chique (30/09): `ERROR 131047` 1,7s ANTES do
 * `SENT`, e o `SENT` atrasado devolvia a mensagem para "enviada".
 */
describe("mesclarStatusNaLinha", () => {
  const AGORA = new Date("2026-10-13T13:08:29.000Z");
  const recusa131047 = {
    code: "ERROR",
    error: {
      code: 131047,
      details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
      message: "Re-engagement message",
    },
  };
  const evento = (messageStatus: Record<string, unknown>) =>
    readMessageStatus({ type: "MESSAGE_STATUS", messageId: "m-1", messageStatus })!;

  it("uma recusa grava status, código, motivo e o corpo cru", () => {
    const { patch, progride } = mesclarStatusNaLinha(
      { status: "sent", raw_payload: { request: { to: "5591" } }, provider_message_id: null },
      evento(recusa131047),
      recusa131047,
      AGORA,
    );
    expect(progride).toBe(true);
    expect(patch.status).toBe("failed");
    expect(patch.raw_payload.request).toEqual({ to: "5591" });
    expect(patch.raw_payload.status_event).toMatchObject({
      code: "failed",
      provider_code: "131047",
      failure_raw: recusa131047,
    });
    expect(String((patch.raw_payload.status_event as Record<string, unknown>).detail))
      .toContain("24 hours");
  });

  it("uma segunda falha SEM motivo NÃO apaga o motivo da primeira", () => {
    const primeira = mesclarStatusNaLinha(
      { status: "sent", raw_payload: {}, provider_message_id: null },
      evento(recusa131047),
      recusa131047,
      AGORA,
    );
    const semMotivo = { code: "REJECTED", description: "The message was rejected by the provider" };
    const { patch } = mesclarStatusNaLinha(
      { status: "failed", raw_payload: primeira.patch.raw_payload, provider_message_id: null },
      evento(semMotivo),
      semMotivo,
      AGORA,
    );
    expect(patch.raw_payload.status_event).toMatchObject({
      code: "failed",
      provider_code: "131047",
    });
    expect(String((patch.raw_payload.status_event as Record<string, unknown>).detail))
      .toContain("24 hours");
  });

  it("`failed` é TERMINAL: um SENT atrasado não devolve a mensagem para enviada", () => {
    const { patch, progride } = mesclarStatusNaLinha(
      {
        status: "failed",
        raw_payload: { status_event: { code: "failed", provider_code: "131047", detail: "x" } },
        provider_message_id: null,
      },
      evento({ code: "SENT", providerMessageId: "P-1" }),
      { code: "SENT", providerMessageId: "P-1" },
      AGORA,
    );
    expect(progride).toBe(false);
    expect(patch.status).toBeUndefined();
    // A chave de correlação ainda é gravada — é ela que acha os callbacks seguintes.
    expect(patch.provider_message_id).toBe("P-1");
    // E o motivo sobrevive ao evento de sucesso.
    expect(patch.raw_payload.status_event).toMatchObject({ provider_code: "131047", detail: "x" });
  });

  it("evento de sucesso não grava `failure_raw`", () => {
    const { patch } = mesclarStatusNaLinha(
      { status: null, raw_payload: {}, provider_message_id: null },
      evento({ code: "DELIVERED" }),
      { code: "DELIVERED" },
      AGORA,
    );
    expect(patch.raw_payload.status_event).not.toHaveProperty("failure_raw");
  });
});
