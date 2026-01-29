import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { triggerFollowUpAutomation } from "./useAutoFollowUp";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

export type PipeWhatsapp = Tables<"pipe_whatsapp">;
export type PipeWhatsappInsert = TablesInsert<"pipe_whatsapp">;
export type PipeWhatsappUpdate = TablesUpdate<"pipe_whatsapp">;

// Using database enum values
export type PipeWhatsappStatus = "novo" | "abordado" | "respondeu" | "esfriou" | "agendado";

export const statusColumns: { id: PipeWhatsappStatus; title: string; color: string }[] = [
  { id: "novo", title: "Novo", color: "#6366f1" },
  { id: "abordado", title: "Abordado", color: "#f59e0b" },
  { id: "respondeu", title: "Respondeu", color: "#3b82f6" },
  { id: "esfriou", title: "Esfriou", color: "#ef4444" },
  { id: "agendado", title: "Agendado ✓", color: "#22c55e" },
];

export function usePipeWhatsapp() {
  useRealtimeSubscription("pipe_whatsapp", ["pipe_whatsapp", "follow_ups"]);
  
  return useQuery({
    queryKey: ["pipe_whatsapp"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipe_whatsapp")
        .select(`
          *,
          lead:leads(
            id, name, company, email, phone, rating, origin, segment, faturamento, urgency, notes, compromisso_date, ai_disabled,
            sdr:team_members!leads_sdr_id_fkey(id, name),
            closer:team_members!leads_closer_id_fkey(id, name),
            lead_tags(tag:tags(id, name, color))
          ),
          sdr:team_members!pipe_whatsapp_sdr_id_fkey(id, name)
        `)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePipeWhatsapp() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (item: PipeWhatsappInsert) => {
      const { data, error } = await supabase
        .from("pipe_whatsapp")
        .insert(item)
        .select()
        .single();
      
      if (error) throw error;

      // Trigger automation for the initial status
      await triggerFollowUpAutomation({
        leadId: data.lead_id,
        assignedTo: data.sdr_id,
        pipeType: "whatsapp",
        stage: data.status,
        sourcePipeId: data.id,
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

export function useUpdatePipeWhatsapp() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, leadId, sdrId, ...updates }: PipeWhatsappUpdate & { id: string; leadId?: string; sdrId?: string | null }) => {
      const { data, error } = await supabase
        .from("pipe_whatsapp")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;

      // Trigger automation if status changed
      if (updates.status && leadId) {
        await triggerFollowUpAutomation({
          leadId: leadId,
          assignedTo: sdrId || data.sdr_id,
          pipeType: "whatsapp",
          stage: updates.status,
          sourcePipeId: data.id,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

export function useDeletePipeWhatsapp() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pipe_whatsapp")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}
