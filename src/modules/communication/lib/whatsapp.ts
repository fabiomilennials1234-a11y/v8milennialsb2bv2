import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  prefetchChatRoute,
  prefetchChatData,
} from "@/modules/communication/lib/chatPrefetch";
import { useCurrentTeamMember } from "@/modules/identity";
import { useWhatsAppInstancesForUser } from "@/modules/communication/hooks/chat/useWhatsAppInstances";
/** DDDs que existem no Brasil (Anatel). Fora dessa lista não há como discar. */
const BR_AREA_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Normaliza um telefone para o formato que a Uazapi espera: 55 + DDD + 9 dígitos.
 * Retorna `null` quando o telefone não pode ser um celular brasileiro.
 *
 * Por que validar em vez de só concatenar: o código antigo fazia
 * `return '55' + cleaned` incondicionalmente, então qualquer lixo de 11 dígitos
 * virava um número "válido" que só falhava lá na ponta, com a Uazapi
 * respondendo 500 "the number ... is not on WhatsApp" — que chegava no
 * operador como "Edge Function returned a non-2xx status code". Havia 159 leads
 * em 24 orgs nessa condição (levantamento 2026-07-29). Melhor recusar aqui, com
 * mensagem que aponta pro cadastro, do que fingir que dá e falhar opaco.
 *
 * Nota sobre o "55" do início: ele só é tratado como código de país quando o
 * comprimento total obriga (12 ou 13 dígitos). Um número local de 11 dígitos
 * começando com 55 é DDD 55 (Santa Maria/RS) — o código antigo decepava esses
 * dois dígitos e rejeitava o resto por ficar curto, quebrando 40 leads em 13
 * orgs que nunca conseguiram receber mensagem.
 */
export function formatPhoneForWhatsApp(phone: string | undefined): string | null {
  if (!phone) return null;

  let cleaned = phone.replace(/\D/g, '');

  // "55" na frente só é DDI se o tamanho não couber num número local.
  // 12 = 55 + DDD + 8 dígitos; 13 = 55 + DDD + 9 dígitos.
  if (cleaned.startsWith('55') && (cleaned.length === 12 || cleaned.length === 13)) {
    cleaned = cleaned.substring(2);
  }

  // DDD às vezes vem discado como "011"
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // Formato antigo (DDD + 8 dígitos): recebe o nono dígito.
  if (cleaned.length === 10) {
    cleaned = cleaned.substring(0, 2) + '9' + cleaned.substring(2);
  }

  // A partir daqui só passa o que tem cara de celular BR de verdade.
  if (cleaned.length !== 11) return null;
  if (!BR_AREA_CODES.has(Number(cleaned.substring(0, 2)))) return null;
  // Celular no Brasil começa com 9 desde a migração do nono dígito (2016).
  if (cleaned[2] !== '9') return null;

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

  // Quando a org/usuário não tem nenhuma instância interna de WhatsApp, o chat
  // interno (`/chat-whatsapp`) não tem em qual instância abrir a conversa e cai
  // numa tela vazia ("Nenhuma instância WhatsApp disponível"). Nesse caso o
  // botão deve mandar direto pro WhatsApp Web (wa.me) para o vendedor falar com
  // o lead. Só consideramos "sem instância" depois que a query resolveu
  // (`isFetched`) para não desviar por engano enquanto ainda está carregando.
  const { data: instances, isFetched: instancesFetched } =
    useWhatsAppInstancesForUser();
  const hasNoInstance = instancesFetched && (instances?.length ?? 0) === 0;

  return useMemo<OpenWhatsAppChat>(() => {
    const fn = ((phone: string | undefined, e?: React.MouseEvent, instanceId?: string) => {
      if (e) e.stopPropagation();
      const formatted = formatPhoneForWhatsApp(phone);
      if (!formatted) return;
      if (hasNoInstance) {
        window.open(`https://wa.me/${formatted}`, "_blank", "noopener,noreferrer");
        return;
      }
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
  }, [navigate, queryClient, organizationId, hasNoInstance]);
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
