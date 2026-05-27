import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

export type PipeWhatsAppStatus = 'novo' | 'abordado' | 'respondeu' | 'esfriou' | 'agendado';

export interface WhatsAppFunnelLead {
  id: string;
  name: string;
  phone: string | null;
  company: string | null;
  email: string | null;
  pipe_whatsapp: PipeWhatsAppStatus | null;
  origin: string;
  rating: number | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
  organization_id: string;
}

export const FUNNEL_STAGES: { id: PipeWhatsAppStatus; title: string; color: string }[] = [
  { id: 'novo', title: 'Novo', color: '#8B5CF6' },
  { id: 'abordado', title: 'Abordado', color: '#3B82F6' },
  { id: 'respondeu', title: 'Respondeu', color: '#10B981' },
  { id: 'esfriou', title: 'Esfriou', color: '#EF4444' },
  { id: 'agendado', title: 'Agendado', color: '#F59E0B' },
];

// Hook para buscar leads do funil WhatsApp
export function useWhatsAppFunnelLeads() {
  useRealtimeSubscription("leads", ["whatsapp-funnel-leads"]);
  
  return useQuery({
    queryKey: ["whatsapp-funnel-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .not("pipe_whatsapp", "is", null)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as WhatsAppFunnelLead[];
    },
  });
}

// Hook para atualizar estágio do lead no funil
export function useUpdateLeadFunnelStage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ leadId, stage }: { leadId: string; stage: PipeWhatsAppStatus }) => {
      const { data, error } = await supabase
        .from("leads")
        .update({ 
          pipe_whatsapp: stage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-funnel-leads"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

// Agrupar leads por estágio
export function groupLeadsByStage(leads: WhatsAppFunnelLead[] | undefined) {
  const grouped: Record<PipeWhatsAppStatus, WhatsAppFunnelLead[]> = {
    novo: [],
    abordado: [],
    respondeu: [],
    esfriou: [],
    agendado: [],
  };
  
  if (!leads) return grouped;
  
  leads.forEach(lead => {
    const stage = lead.pipe_whatsapp || 'novo';
    if (grouped[stage]) {
      grouped[stage].push(lead);
    }
  });
  
  return grouped;
}
