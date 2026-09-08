/**
 * Histórico de conversas do Oráculo — a lista e a reabertura.
 *
 * Filtros recortam organização ativa e dono; RLS valida acesso no servidor.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OraculoMensagem } from "./useOraculoTurno";

export interface OraculoConversaResumo {
  id: string;
  titulo: string;
  ultimaMensagemEm: string | null;
}

export function useOraculoConversas(userId?: string, organizationId?: string) {
  return useQuery({
    queryKey: ["oraculo_conversations", userId, organizationId],
    enabled: !!userId && !!organizationId,
    queryFn: async (): Promise<OraculoConversaResumo[]> => {
      const { data, error } = await supabase
        .from("oraculo_conversations")
        .select("id, title, last_message_at")
        .eq("organization_id", organizationId!)
        .eq("user_id", userId!)
        .is("archived_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(50);

      if (error) throw error;

      return (data ?? []).map((c) => ({
        id: c.id,
        titulo: c.title?.trim() || "Conversa sem título",
        ultimaMensagemEm: c.last_message_at,
      }));
    },
  });
}

export function useOraculoTurnos(conversaId: string | null, userId?: string, organizationId?: string) {
  return useQuery({
    queryKey: ["oraculo_turns", userId, organizationId, conversaId],
    enabled: !!conversaId && !!userId && !!organizationId,
    queryFn: async (): Promise<OraculoMensagem[]> => {
      const { data, error } = await supabase
        .from("oraculo_turns")
        .select("id, role, content, tools_used, created_at")
        .eq("conversation_id", conversaId!)
        .eq("organization_id", organizationId!)
        .eq("user_id", userId!)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return (data ?? []).map((t) => ({
        id: t.id,
        role: t.role as "user" | "assistant",
        content: t.content,
        procedencia: t.tools_used ?? undefined,
        criadaEm: new Date(t.created_at as string),
      }));
    },
  });
}
