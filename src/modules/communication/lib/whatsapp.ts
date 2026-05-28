import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  prefetchChatRoute,
  prefetchChatData,
} from "@/modules/communication/lib/chatPrefetch";
import { useCurrentTeamMember } from "@/modules/identity";
// Format phone number for WhatsApp: 55 + DDD (without 0) + number (add 9 if short)
export function formatPhoneForWhatsApp(phone: string | undefined): string | null {
  if (!phone) return null;

  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, '');

  // If already starts with 55, remove it to reprocess
  if (cleaned.startsWith('55')) {
    cleaned = cleaned.substring(2);
  }

  // Remove leading 0 from DDD if present
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // If number is too short (DDD + 8 digits = 10), add 9 after DDD
  // DDD is 2 digits, so if total is 10, we need to add 9
  if (cleaned.length === 10) {
    cleaned = cleaned.substring(0, 2) + '9' + cleaned.substring(2);
  }

  // Add country code
  return '55' + cleaned;
}

export function openWhatsApp(phone: string | undefined, e?: React.MouseEvent) {
  if (e) {
    e.stopPropagation();
  }

  const formattedPhone = formatPhoneForWhatsApp(phone);
  if (formattedPhone) {
    window.open(`https://wa.me/${formattedPhone}`, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Retorno de `useOpenWhatsAppChat`:
 *  - `open(phone, e?, instanceId?)` — navega para o chat interno.
 *  - `prefetchRoute()` — dispara o chunk JS da rota (warm-up no hover).
 *  - `prefetchData(phone, instanceId?)` — popula o cache da conversa
 *    (warm-up no mousedown). Idempotente; segura para chamadas repetidas.
 *
 * Backwards-compat: o objeto retornado é também callable como função
 * `(phone, e?, instanceId?)`, preservando o uso pré-existente
 * `openWhatsApp(lead.phone, e)` em LeadCard, FollowUpCard, etc.
 */
export interface OpenWhatsAppChat {
  (phone: string | undefined, e?: React.MouseEvent, instanceId?: string): void;
  prefetchRoute: () => void;
  prefetchData: (phone: string | undefined, instanceId?: string) => void;
}

/**
 * Hook que retorna um callback para abrir a conversa do lead diretamente
 * no chat interno do Torque (/chat-whatsapp?phone=...).
 * Substitui openWhatsApp nos contextos operacionais de lead.
 *
 * `instanceId` é opcional. Quando fornecido, vai como `?instance=...` e o
 * chat usa essa instância se ela estiver na lista permitida do usuário —
 * caso contrário ele resolve via busca segura. Se não souber a instância,
 * deixe undefined e o chat resolve sozinho.
 *
 * Performance: para acelerar a transição Kanban→chat, o callable
 * expõe `prefetchRoute()` e `prefetchData(phone)` — chame em
 * `onMouseEnter` (rota) e `onMouseDown` (dados) do botão.
 */
export function useOpenWhatsAppChat(): OpenWhatsAppChat {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useMemo<OpenWhatsAppChat>(() => {
    const fn = ((phone: string | undefined, e?: React.MouseEvent, instanceId?: string) => {
      if (e) e.stopPropagation();
      const formatted = formatPhoneForWhatsApp(phone);
      if (!formatted) return;
      const params = new URLSearchParams({ phone: formatted });
      if (instanceId) params.set("instance", instanceId);
      navigate(`/chat-whatsapp?${params.toString()}`);
    }) as OpenWhatsAppChat;

    fn.prefetchRoute = () => {
      // Fire-and-forget — erros ficam dentro do helper
      void prefetchChatRoute();
    };

    fn.prefetchData = (phone, instanceId) => {
      if (!organizationId) return;
      const formatted = formatPhoneForWhatsApp(phone);
      if (!formatted) return;
      void prefetchChatData(queryClient, {
        organizationId,
        phoneNumber: formatted,
        instanceId: instanceId ?? null,
      });
    };

    return fn;
  }, [navigate, queryClient, organizationId]);
}

/**
 * Mesma idéia que `useOpenWhatsAppChat`, mas voltado a call-sites que só
 * precisam fazer prefetch (ex.: hover em link, foco em row de tabela)
 * sem o callable de navegação. Mais leve para usar em listas grandes.
 */
export function useChatPrefetch() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useCallback(
    (phone: string | undefined, instanceId?: string) => {
      void prefetchChatRoute();
      if (!organizationId) return;
      const formatted = formatPhoneForWhatsApp(phone);
      if (!formatted) return;
      void prefetchChatData(queryClient, {
        organizationId,
        phoneNumber: formatted,
        instanceId: instanceId ?? null,
      });
    },
    [organizationId, queryClient],
  );
}
