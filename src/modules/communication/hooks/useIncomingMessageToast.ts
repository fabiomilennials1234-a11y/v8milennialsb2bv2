/**
 * useIncomingMessageToast — aviso in-app de mensagem recebida na CAIXA SOCIAL.
 *
 * Subscribe Realtime em `channel_messages` INSERT, filtrando por org. Exibe
 * Sonner com o nome de quem mandou + preview de 80 chars, e o botão leva à
 * conversa. Suprimido nas rotas de chat (o usuário já está vendo o inbox).
 *
 * ─── ESTE AVISO ESTAVA MORTO POR CONSTRUÇÃO ──────────────────────────────────
 *
 * A condição era `row.direction !== 'inbound'`, e `channel_messages_direction_check`
 * só aceita `('incoming','outgoing')`. Nenhum writer jamais gravou `'inbound'`:
 * NENHUMA linha em produção podia satisfazer a condição, então o aviso nunca
 * tocou desde que foi escrito. Não era convenção divergente — era código morto.
 *
 * Corrigir o valor para `'incoming'` ACORDA o aviso. E aí a pergunta deixa de ser
 * "qual é o valor certo" e passa a ser PARA QUEM ele deve tocar — porque `'incoming'`
 * já é gravado hoje pelo `meta-webhook`, em produção, para as ~30 orgs. Um typo
 * consertado não pode ligar sozinho uma notificação para todo mundo.
 *
 * ─── A DECISÃO: O AVISO TOCA SÓ PARA A CAIXA QUE ELE CONSEGUE ABRIR ──────────
 *
 * Toca quando a linha é `channel = 'instagram'` E tem `messaging_channel_id` —
 * a rota NotificaMe, que é a única que o inbox social renderiza e a única que o
 * deep-link `?box=` abre (`useInboxBoxes` só monta caixa para
 * `messaging_channels.channel_type = 'instagram'`).
 *
 * NÃO toca para o resto de `channel_messages`, e cada exclusão tem motivo:
 *
 *   - rota META/GRAPH (`meta-webhook`, `messaging_channel_id` NULL): essas
 *     conversas moram em `chat-meta`, OUTRO inbox. O aviso levaria o usuário a
 *     `/chat-whatsapp`, onde a conversa anunciada não existe — e "aviso que leva
 *     a lugar nenhum é pior que aviso nenhum". Ligá-las seria, além disso,
 *     estrear uma notificação em 30 orgs de carona num typo;
 *   - WhatsApp: o inbound de WhatsApp NÃO passa por `channel_messages` (vai para
 *     `whatsapp_messages`, via `whatsapp-webhook`). Apesar do nome que este hook
 *     carregava, ele nunca foi o avisador do WhatsApp;
 *   - qualquer canal social FUTURO (WhatsApp via NotificaMe, Messenger): terá
 *     `messaging_channel_id` mas ainda não tem caixa no inbox. Exigir
 *     `channel = 'instagram'` faz o aviso ESPERAR o inbox em vez de anunciar
 *     conversa que nenhuma tela abre. Opt-in explícito, uma linha.
 *
 * ⚠️ DEPENDE DA POLICY. O Realtime avalia `channel_messages_org_access` em
 * `apply_rls()`; enquanto ela usava `get_user_organization_id()` (singular),
 * usuário multi-org não recebia evento nenhum e este aviso ficava mudo para ele
 * sem sintoma. Alinhado em `20270816110000_channel_messages_multi_org_read.sql`.
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useOrganization } from "@/modules/identity";
/** Rotas onde o toast é suprimido — user já está vendo o chat */
const CHAT_ROUTE_PATTERNS = [/^\/chat(\/|$)/, /^\/chat-whatsapp/];

function isChatRoute(pathname: string): boolean {
  return CHAT_ROUTE_PATTERNS.some((p) => p.test(pathname));
}

export function useIncomingMessageToast() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const location = useLocation();
  const navigate = useNavigate();

  // Refs pra evitar stale closures no callback do Realtime
  const locationRef = useRef(location);
  locationRef.current = location;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!organizationId || !user) return;

    const channel = supabase
      .channel(`incoming-msg-toast-${organizationId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "INSERT",
          schema: "public",
          table: "channel_messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new;

          // Só mensagem de ENTRADA. `'incoming'` é o único valor de entrada que
          // `channel_messages_direction_check` aceita — ver o cabeçalho.
          if (row.direction !== "incoming") return;

          /**
           * Só a caixa social do NotificaMe, que é a única que este aviso sabe
           * abrir. As DUAS condições são necessárias: `channel` sozinho deixaria
           * passar a rota Meta/Graph (que também grava `'instagram'`, com
           * `messaging_channel_id` NULL) e `messaging_channel_id` sozinho
           * deixaria passar um canal social futuro que ainda não tem caixa no
           * inbox. Ver a decisão no cabeçalho.
           */
          const messagingChannelId = row.messaging_channel_id as string | null;
          if (row.channel !== "instagram" || !messagingChannelId) return;

          // Suprime se user está em rota de chat
          if (isChatRoute(locationRef.current.pathname)) return;

          const senderName = (row.sender_name as string) || "Contato";
          const rawContent = (row.content as string) || "";
          // Mensagem SÓ de mídia chega com `content` NULL — `pickContent` não
          // inventa texto para ela. Com o formato `nome: preview`, isso sairia
          // como "Ana: ", que se lê como aviso truncado. Sem texto, a frase
          // muda de forma em vez de mostrar dois-pontos e o vazio.
          const preview =
            rawContent.length > 80 ? rawContent.slice(0, 80) + "..." : rawContent;
          const title = rawContent
            ? `${senderName}: ${preview}`
            : row.media_url
              ? `${senderName} enviou uma mídia`
              : `${senderName} enviou uma mensagem`;

          // A conversa mora numa CAIXA. Sem o `?box=`, o botão levaria o
          // usuário para a caixa que estivesse selecionada — quase sempre um
          // número de WhatsApp — e a conversa anunciada não estaria lá. Aviso
          // que leva a lugar nenhum é pior que aviso nenhum. O id está sempre
          // presente aqui: o guard acima já descartou a linha sem ele.
          const target = `/chat-whatsapp?box=${messagingChannelId}`;

          toast(title, {
            action: {
              label: "Ver conversa",
              onClick: () => {
                navigateRef.current(target);
              },
            },
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, user]);
}
