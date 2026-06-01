import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";

export interface QuickBlastInput {
  instance_id: string;
  lead_ids: string[];
  message: string;
  delay_min_ms?: number;
  delay_max_ms?: number;
  max_leads?: number;
  scheduled_for?: string;
  image_url?: string;
}

export interface QuickBlastResult {
  ok: true;
  sender_job_id: string;
  uazapi_sender_id: string;
  count: number;
  skipped: { noPhone: number; duplicates: number; overCap: number };
}

/**
 * Fire a Quick Blast (Disparo Rápido) from a kanban/list lead selection.
 * Reuses the Mass Send dispatch core via the quick-blast-create edge function.
 */
export function useQuickBlast() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (input: QuickBlastInput) => {
      const { data, error } = await supabase.functions.invoke("quick-blast-create", {
        body: input,
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as QuickBlastResult;
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["uazapi_sender_jobs", teamMember.organization_id] });
      }
    },
  });
}
