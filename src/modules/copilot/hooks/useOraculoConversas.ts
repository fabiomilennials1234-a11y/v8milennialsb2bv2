/**
 * Histórico de conversas do Oráculo — a lista e a reabertura.
 *
 * A leitura é direta nas tabelas, e a RLS é quem recorta: cada pessoa lê as
 * próprias conversas. Não há filtro por organização no cliente porque não é o
 * cliente que decide isso.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OraculoMensagem } from "./useOraculoTurno";

export interface OraculoConversaResumo {
  id: string;
  titulo: string;
  ultimaMensagemEm: string | null;
}

export function useOraculoConversas(userId?: string) {
  return useQuery({
    queryKey: ["oraculo_conversations", userId],
    enabled: !!userId,
    queryFn: async (): Promise<OraculoConversaResumo[]> => {
      const { data, error } = await supabase
        .from("oraculo_conversations")
        .select("id, title, last_message_at")
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

export function useOraculoTurnos(conversaId: string | null) {
  return useQuery({
    queryKey: ["oraculo_turns", conversaId],
    enabled: !!conversaId,
    queryFn: async (): Promise<OraculoMensagem[]> => {
      const { data, error } = await supabase
        .from("oraculo_turns")
        .select("id, role, content, tools_used, created_at")
        .eq("conversation_id", conversaId!)
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
