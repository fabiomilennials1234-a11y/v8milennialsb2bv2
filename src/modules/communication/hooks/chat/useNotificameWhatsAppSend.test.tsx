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
