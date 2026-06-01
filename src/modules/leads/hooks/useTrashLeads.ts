import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
export interface TrashLead {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  deleted_at: string;
  deleted_by: string | null;
}

export function useTrashLeads() {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["trash_leads", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_trash_leads" as any);
      if (error) throw error;
      return (data ?? []) as TrashLead[];
    },
    enabled: !!organizationId,
  });
}

export function useRestoreLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase.rpc("restore_lead" as any, { p_lead_id: leadId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash_leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useRestoreLeadsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadIds: string[]) => {
      const { error } = await supabase.rpc("restore_leads_bulk" as any, { p_lead_ids: leadIds });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash_leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function usePurgeLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase.rpc("purge_lead" as any, { p_lead_id: leadId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trash_leads"] }),
  });
}
