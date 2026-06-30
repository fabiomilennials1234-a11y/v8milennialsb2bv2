/**
 * useIncomingMessageToast — toast in-app para mensagens WhatsApp inbound.
 *
 * Subscribe Realtime em `channel_messages` INSERT, filtra org_id + direction=inbound.
 * Exibe Sonner toast com sender_name + preview truncado (80 chars).
 * Suprime toast quando user já está em rotas de chat (/chat, /chat-whatsapp).
 * Click no toast navega pra chat do lead.
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
/** Rotas onde o toast é suprimido — user já está vendo o chat */
const CHAT_ROUTE_PATTERNS = [/^\/chat(\/|$)/, /^\/chat-whatsapp/];

function isChatRoute(pathname: string): boolean {
  return CHAT_ROUTE_PATTERNS.some((p) => p.test(pathname));
}

export function useIncomingMessageToast() {
  const { user, organizationId } = useAuth();
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

          // Só inbound
          if (row.direction !== "inbound") return;

          // Suprime se user está em rota de chat
          if (isChatRoute(locationRef.current.pathname)) return;

          const senderName = (row.sender_name as string) || "Contato";
          const rawContent = (row.content as string) || "";
          const preview =
            rawContent.length > 80
              ? rawContent.slice(0, 80) + "..."
              : rawContent;

          toast(`${senderName}: ${preview}`, {
            action: {
              label: "Ver conversa",
              onClick: () => {
                navigateRef.current("/chat-whatsapp");
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
