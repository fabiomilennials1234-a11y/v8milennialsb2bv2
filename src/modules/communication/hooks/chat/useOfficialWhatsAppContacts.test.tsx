/**
 * A LISTA da caixa de WhatsApp oficial.
 *
 * Hook irmão de `useSocialContacts`, e não um parâmetro a mais nele, por causa da
 * RPC: `get_social_conversation_list` resolve o argumento contra
 * `messaging_channels` e recusa com 42501 o uuid de uma instância de WhatsApp.
 * Quem lê esta caixa é `get_official_whatsapp_conversation_list`.
 *
 * O mapeamento de linha é COMPARTILHADO de propósito — a forma de retorno das
 * duas RPCs é a mesma, e duas cópias divergiriam na primeira coluna nova.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

const teamMemberMock = vi.fn();
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => teamMemberMock(),
}));

import { useOfficialWhatsAppContacts } from "./useOfficialWhatsAppContacts";

const ORG = "38f3bea4-44c6-4732-bb20-065f547a7ed8";
const INSTANCIA = "7312692e-b9b4-4f90-aba3-09cff992bbfc";

const LINHA = {
  contact_external_id: "554884334050",
  sender_name: "Gabriel Gipp",
  sender_profile_pic: null,
  contact_handle: null,
  last_message: "Olá, testando a conexão",
  last_message_time: "2026-08-18T19:03:28+00:00",
  last_message_direction: "incoming",
  unread_count: 1,
  lead_id: null,
  lead_name: null,
};

const newQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [LINHA], error: null });
  teamMemberMock.mockReset();
  teamMemberMock.mockReturnValue({ data: { organization_id: ORG } });
});

describe("useOfficialWhatsAppContacts", () => {
  it("chama a RPC da caixa oficial com org e instância", async () => {
    const { result } = renderHook(() => useOfficialWhatsAppContacts(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledWith("get_official_whatsapp_conversation_list", {
      p_org: ORG,
      p_instance: INSTANCIA,
      p_limit: 200,
    });
  });

  it("NUNCA chama a RPC social — ela recusa uuid de instância com 42501", async () => {
    const { result } = renderHook(() => useOfficialWhatsAppContacts(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).not.toHaveBeenCalledWith(
      "get_social_conversation_list",
      expect.anything(),
    );
  });

  it("mapeia a linha para um contato da caixa oficial, com a chave no namespace certo", async () => {
    const { result } = renderHook(() => useOfficialWhatsAppContacts(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      expect.objectContaining({
        channel: "whatsapp_oficial",
        conversation_key: `whatsapp_oficial:${INSTANCIA}:554884334050`,
        messaging_channel_id: INSTANCIA,
        external_user_id: "554884334050",
        display_name: "Gabriel Gipp",
        last_message: "Olá, testando a conexão",
        last_message_direction: "incoming",
        unread_count: 1,
      }),
    ]);
  });

  it("direção que o banco não deveria produzir vira null, nunca 'incoming' por default", async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...LINHA, last_message_direction: "lixo" }],
      error: null,
    });

    const { result } = renderHook(() => useOfficialWhatsAppContacts(INSTANCIA), {
      wrapper: wrap(newQc()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].last_message_direction).toBeNull();
  });

  it("sem instância não chama nada — é o estado de quem abriu outra caixa", async () => {
    renderHook(() => useOfficialWhatsAppContacts(null), { wrapper: wrap(newQc()) });

    await new Promise((r) => setTimeout(r, 10));
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
