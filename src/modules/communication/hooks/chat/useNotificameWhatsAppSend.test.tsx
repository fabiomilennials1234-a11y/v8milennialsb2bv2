/**
 * Envio pela caixa do WhatsApp oficial.
 *
 * Hook PRÓPRIO, e não o `useWhatsAppSend`, por um motivo medido: aquele faz um
 * upsert otimista em `whatsapp_messages` logo depois de invocar o proxy. O
 * inbound do canal oficial grava em `channel_messages`, e o provider grava a
 * SAÍDA na mesma tabela — herdar o upsert partiria a conversa em duas fontes,
 * com a entrada de um lado e a resposta do outro.
 *
 * Aqui a única escrita é a do servidor. O feedback imediato vem de invalidar as
 * chaves no `onSuccess`, com o id real que o provider devolveu — nunca de
 * inventar linha no cliente.
 *
 * A rota é a MESMA do WhatsApp comum (`whatsapp-api-proxy`, `action: sendText`):
 * é ela que resolve o provider a partir da instância e passa por governor, janela
 * e templates. O canal oficial é atendido ali desde o PR #1640.
 */
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));

const teamMemberMock = vi.fn();
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => teamMemberMock(),
}));

import { useNotificameWhatsAppSend } from "./useNotificameWhatsAppSend";

const ORG = "38f3bea4-44c6-4732-bb20-065f547a7ed8";
const INSTANCIA = "7312692e-b9b4-4f90-aba3-09cff992bbfc";
const TELEFONE = "554884334050";

const newQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const wrap = (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    data: { ok: true, result: { message_id: "wamid-1", status: "sent" } },
    error: null,
  });
  teamMemberMock.mockReset();
  teamMemberMock.mockReturnValue({ data: { organization_id: ORG } });
});

describe("useNotificameWhatsAppSend — o corpo que sai", () => {
  it("envia pelo proxy, com instância, org e telefone", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await result.current.mutateAsync({ to: TELEFONE, text: "oi" });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [fn, opts] = invokeMock.mock.calls[0];
    expect(fn).toBe("whatsapp-api-proxy");
    expect(opts.body).toMatchObject({
      action: "sendText",
      instance_id: INSTANCIA,
      organization_id: ORG,
      payload: { number: TELEFONE, text: "oi" },
    });
  });

  it("NÃO escreve em whatsapp_messages — a conversa vive numa tabela só", async () => {
    // O dublê do cliente Supabase só expõe `functions`. Se o hook tentasse o
    // upsert que o `useWhatsAppSend` faz, ele quebraria aqui — e é essa ausência
    // de `from` que prende a decisão.
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await expect(
      result.current.mutateAsync({ to: TELEFONE, text: "oi" }),
    ).resolves.toBeDefined();
  });
});

describe("useNotificameWhatsAppSend — as guardas", () => {
  it("sem instância não chama o servidor", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(null), {
      wrapper: wrap(newQc()),
    });
    await expect(result.current.mutateAsync({ to: TELEFONE, text: "oi" })).rejects.toThrow();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("sem org resolvida não chama o servidor", async () => {
    teamMemberMock.mockReturnValue({ data: null });
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });
    await expect(result.current.mutateAsync({ to: TELEFONE, text: "oi" })).rejects.toThrow();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("mensagem vazia não chama o servidor", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });
    await expect(result.current.mutateAsync({ to: TELEFONE, text: "   " })).rejects.toThrow();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

/**
 * MÍDIA (decisão Q7 do spec: entra na v1).
 *
 * O provider do canal oficial exige URL PÚBLICA e recusa base64 com
 * `NotSupportedError` — e é justamente URL pública o que o composer já produz,
 * porque `uploadSocialAttachment` publica no bucket antes de enviar.
 *
 * Áudio vai por `sendAudio` e não por `sendMedia(type:'audio')`: é a ação que o
 * proxy traduz para `type: 'ptt'`, a mensagem de voz. `sendMedia(audio)` produz
 * anexo de arquivo — some do balão de voz e o cliente recebe outro objeto.
 */
describe("useNotificameWhatsAppSend — mídia", () => {
  const corpoDe = (i: number) => invokeMock.mock.calls[i][1].body;

  it("imagem vai por sendMedia, com a URL pública e a legenda", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await result.current.mutateAsync({
      to: TELEFONE,
      text: "olha o catálogo",
      media: {
        type: "image",
        url: "https://storage.example/cat.jpg",
        filename: "cat.jpg",
      },
    });

    expect(corpoDe(0)).toMatchObject({
      action: "sendMedia",
      instance_id: INSTANCIA,
      payload: {
        number: TELEFONE,
        type: "image",
        file: "https://storage.example/cat.jpg",
        filename: "cat.jpg",
        caption: "olha o catálogo",
      },
    });
  });

  it("áudio gravado em ogg/opus vai por sendAudio — é o que vira mensagem de voz (ptt)", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await result.current.mutateAsync({
      to: TELEFONE,
      media: {
        type: "audio",
        url: "https://storage.example/voz.ogg",
        // O MIME é o que decide. Sem ele o envio degrada para áudio comum — ver
        // o bloco "nota de voz exige ogg/opus" no fim deste arquivo.
        mime: "audio/ogg;codecs=opus",
      },
    });

    expect(corpoDe(0)).toMatchObject({
      action: "sendAudio",
      payload: { number: TELEFONE, file: "https://storage.example/voz.ogg" },
    });
  });

  it("documento é aceito no WhatsApp — o veto do provider é só no Instagram", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await result.current.mutateAsync({
      to: TELEFONE,
      media: {
        type: "document",
        url: "https://storage.example/tabela.pdf",
        filename: "tabela.pdf",
      },
    });

    expect(corpoDe(0)).toMatchObject({
      action: "sendMedia",
      payload: { type: "document", filename: "tabela.pdf" },
    });
  });

  it("sem texto e sem mídia continua sendo recusado antes da rede", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await expect(
      result.current.mutateAsync({ to: TELEFONE, text: "   " }),
    ).rejects.toMatchObject({ code: "empty_message" });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

/**
 * NOTA DE VOZ vs ÁUDIO COMUM — o defeito 131053, medido em produção.
 *
 * `sendAudio` vira `ptt` no proxy e `voice: true` no provider, e a Cloud API
 * exige .ogg/OPUS para nota de voz. Um m4a marcado como voz foi aceito pelo
 * fornecedor (`queued`, id real, "enviado" na tela) e recusado pela Meta 2s
 * depois, por callback que o Torque descartava.
 */
describe("useNotificameWhatsAppSend — nota de voz exige ogg/opus", () => {
  const corpoDe = (i: number) => invokeMock.mock.calls[i][1].body;

  it("ogg/opus vai como nota de voz (sendAudio)", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await result.current.mutateAsync({
      to: TELEFONE,
      media: {
        type: "audio",
        url: "https://storage.example/voz.ogg",
        mime: "audio/ogg;codecs=opus",
      },
    });

    expect(corpoDe(0)).toMatchObject({ action: "sendAudio" });
  });

  it("m4a vai como ÁUDIO COMUM — nunca marcado como voz", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await result.current.mutateAsync({
      to: TELEFONE,
      media: {
        type: "audio",
        url: "https://storage.example/audio.m4a",
        mime: "audio/mp4",
      },
    });

    expect(corpoDe(0)).toMatchObject({
      action: "sendMedia",
      payload: { type: "audio", file: "https://storage.example/audio.m4a" },
    });
    expect(corpoDe(0).action).not.toBe("sendAudio");
  });

  it("sem mime conhecido, degrada para áudio comum em vez de prometer voz", async () => {
    const { result } = renderHook(() => useNotificameWhatsAppSend(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await result.current.mutateAsync({
      to: TELEFONE,
      media: { type: "audio", url: "https://storage.example/x.bin" },
    });

    expect(corpoDe(0)).toMatchObject({ action: "sendMedia" });
  });
});
