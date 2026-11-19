/**
 * Prefetch da thread do /chat-whatsapp (src/modules/communication/lib/chatPrefetch.ts).
 *
 * Garantia crítica: o prefetch grava a MESMA chave, com a MESMA busca, que
 * `useWhatsAppMessages` lê ao abrir a conversa. A "armadilha da chave legada":
 * antes o prefetch buscava por `fetchConversationMessages` enquanto a tela
 * buscava por `reconcileConversation` — formatos e snapshot diferentes.
 */
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import type { ChatContact, InboxBox, SocialContact, WhatsAppMessage } from "@/modules/communication/hooks/chat/types";
import { contactKey, interlocutorDaChave } from "@/modules/communication/hooks/chat/types";
import { regimeDaConversaAberta } from "@/modules/communication/lib/regimeDaConversaAberta";

const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/modules/communication/lib/whatsappReconciliation", async (orig) => ({
  ...(await orig<typeof import("@/modules/communication/lib/whatsappReconciliation")>()),
  reconcileConversation: reconcile,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "org-abc", id: "member" } }),
}));
vi.mock("@/modules/communication/hooks/chat/useRealtimeFallback", () => ({ useReconcileInterval: () => false }));

import { prefetchChatData } from "@/modules/communication/lib/chatPrefetch";
import { alvoDoPrefetchDaConversa } from "@/modules/communication/lib/alvoDoPrefetchDaConversa";
import { useWhatsAppMessages } from "@/modules/communication/hooks/chat/useWhatsAppMessages";

const MSG = { id: "m1", message_id: "m1", phone_number: "5511999999999", timestamp: "2026-11-19T10:00:00.000Z" } as WhatsAppMessage;

describe("prefetchChatData", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    reconcile.mockReset();
    reconcile.mockResolvedValue({ messages: [MSG], snapshot: { fingerprint: "f", revisions: {} } });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it.each([
    ["organizationId", { organizationId: "", phoneNumber: "5511999999999", instanceId: "inst-1" }],
    ["phoneNumber", { organizationId: "org-1", phoneNumber: "", instanceId: "inst-1" }],
    ["instanceId (chave incompleta)", { organizationId: "org-1", phoneNumber: "5511999999999" }],
  ])("não dispara fetch sem %s", async (_nome, params) => {
    await prefetchChatData(queryClient, params);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("popula a EXATA chave de useWhatsAppMessages, com snapshot e paginação", async () => {
    await prefetchChatData(queryClient, { organizationId: "org-abc", phoneNumber: "5511999999999", instanceId: "inst-xyz" });
    const key = chatQueryKeys.messages("org-abc", "5511999999999", "inst-xyz");
    expect(queryClient.getQueryData(key)).toEqual([MSG]);
    expect(queryClient.getQueryData(["whatsapp_thread_snapshot", ...key])).toEqual({ fingerprint: "f", revisions: {} });
    expect(queryClient.getQueryData(["whatsapp_thread_pagination", ...key])).toBe(false);
  });

  it("a tela que abre depois do prefetch lê o cache e NÃO refaz a busca", async () => {
    await prefetchChatData(queryClient, { organizationId: "org-abc", phoneNumber: "5511999999999", instanceId: "inst-xyz" });
    expect(reconcile).toHaveBeenCalledTimes(1);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useWhatsAppMessages("5511999999999", "inst-xyz"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([MSG]));
    expect(result.current.isLoading).toBe(false);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("thread já fresca no cache: prefetch não sai para a rede", async () => {
    await prefetchChatData(queryClient, { organizationId: "org-abc", phoneNumber: "5511999999999", instanceId: "inst-xyz" });
    await prefetchChatData(queryClient, { organizationId: "org-abc", phoneNumber: "5511999999999", instanceId: "inst-xyz" });
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});

describe("alvoDoPrefetchDaConversa", () => {
  const caixas: InboxBox[] = [
    { kind: "whatsapp", id: "inst-a", name: "Vendas", status: "connected" },
    { kind: "whatsapp", id: "inst-b", name: "Suporte", status: "connected" },
    { kind: "instagram", id: "ig-1", name: "Insta", status: "connected", handle: "loja" },
  ];
  const contato = { channel: "whatsapp", instance_id: "inst-b", phone_number: "5511988887777" } as ChatContact;

  it("deriva a MESMA chave que a tela lê ao clicar na linha (caixa da linha, não a selecionada)", () => {
    const alvo = alvoDoPrefetchDaConversa(contato, caixas, [caixas[0]], "org-abc");
    // O caminho do clique: chave da linha → regime (caixa) + telefone da linha.
    const chave = contactKey(contato);
    const { instanciaDeChip } = regimeDaConversaAberta({ chave, caixas, marcadas: [caixas[0]] });
    const daTela = chatQueryKeys.messages("org-abc", interlocutorDaChave(chave), instanciaDeChip);
    expect(chatQueryKeys.messages(alvo!.organizationId, alvo!.phoneNumber, alvo!.instanceId)).toEqual(daTela);
    expect(alvo).toEqual({ organizationId: "org-abc", phoneNumber: "5511988887777", instanceId: "inst-b" });
  });

  it("sem org, ou linha de Instagram, não há alvo", () => {
    expect(alvoDoPrefetchDaConversa(contato, caixas, caixas, null)).toBeNull();
    const insta = { channel: "instagram", conversation_key: "instagram:ig-1:123" } as unknown as SocialContact;
    expect(alvoDoPrefetchDaConversa(insta, caixas, caixas, "org-abc")).toBeNull();
  });
});
