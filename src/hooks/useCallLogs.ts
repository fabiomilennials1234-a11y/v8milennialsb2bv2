import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export type CallDirection = "inbound" | "outbound";
export type CallOutcome = "connected" | "no_answer" | "busy" | "voicemail" | "wrong_number" | "callback_scheduled";

export interface CallLog {
  id: string;
  lead_id: string | null;
  user_id: string;
  direction: CallDirection;
  outcome: CallOutcome;
  duration_seconds: number | null;
  notes: string | null;
  phone_number: string | null;
  recording_url: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected: "Atendeu",
  no_answer: "Não atendeu",
  busy: "Ocupado",
  voicemail: "Caixa postal",
  wrong_number: "Número errado",
  callback_scheduled: "Retorno agendado",
};

export function useCallLogs(leadId?: string, limit = 20) {
  const { organizationId } = useOrganization();
  const orgId = organizationId;

  return useQuery<CallLog[]>({
    queryKey: ["call-logs", orgId, leadId, limit],
    queryFn: async () => {
      let q = (supabase.from as any)("call_logs")
        .select("*")
        .eq("organization_id", orgId!)
        .order("started_at", { ascending: false })
        .limit(limit);

      if (leadId) q = q.eq("lead_id", leadId);

      const { data, error } = await q;
      if (error) throw error;
      return data as CallLog[];
    },
    enabled: !!orgId,
  });
}

export interface LogCallInput {
  lead_id?: string;
  direction: CallDirection;
  outcome: CallOutcome;
  duration_seconds?: number;
  notes?: string;
  phone_number?: string;
}

export function useLogCall() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: LogCallInput) => {
      const { data, error } = await (supabase.from as any)("call_logs")
        .insert({
          organization_id: organizationId!,
          user_id: user!.id,
          lead_id: input.lead_id ?? null,
          direction: input.direction,
          outcome: input.outcome,
          duration_seconds: input.duration_seconds ?? null,
          notes: input.notes ?? null,
          phone_number: input.phone_number ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Ligação registrada");
      queryClient.invalidateQueries({ queryKey: ["call-logs"] });
      queryClient.invalidateQueries({ queryKey: ["lead-timeline"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro: ${error.message}`);
    },
  });
}
