/**
 * useDispatchQueueItems — busca itens detalhados da fila de disparos
 * para campanhas e pipes, com suporte a retry de itens falhados.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface QueueItem {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  template_name: string | null;
  action_type: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  error_message: string | null;
  created_at: string | null;
  target_stage_name: string | null;
  sdr_name: string | null;
}

// ─── Campaign queue items ───────────────────────────────────────────────────

export function useCampaignQueueItems(campanhaId: string, status: string | null) {
  return useQuery({
    queryKey: ["campaign_queue_items", campanhaId, status],
    queryFn: async () => {
      let query = supabase
        .from("scheduled_campaign_messages")
        .select(
          `id, action_type, status, scheduled_at, sent_at, error_message, created_at,
           target_stage_id, target_sdr_id, template_id,
           leads!scheduled_campaign_messages_lead_id_fkey(name, phone, email),
           campaign_templates!scheduled_campaign_messages_template_id_fkey(name),
           campanha_stages!scheduled_campaign_messages_target_stage_id_fkey(name)`
        )
        .eq("campanha_id", campanhaId)
        .order("scheduled_at", { ascending: false })
        .limit(200);

      if (status) {
        if (status === "scheduled") {
          query = query.in("status", ["scheduled", "processing"]);
        } else {
          query = query.eq("status", status);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      // Resolve SDR names separately (target_sdr_id has no FK)
      const sdrIds = [...new Set(
        (data ?? []).map((r: any) => r.target_sdr_id).filter(Boolean)
      )];
      let sdrMap: Record<string, string> = {};
      if (sdrIds.length > 0) {
        const { data: sdrData } = await supabase
          .from("team_members")
          .select("id, name")
          .in("id", sdrIds);
        for (const s of sdrData ?? []) {
          sdrMap[s.id] = s.name;
        }
      }

      return (data ?? []).map((row: any) => ({
        id: row.id,
        lead_name: row.leads?.name ?? null,
        lead_phone: row.leads?.phone ?? null,
        lead_email: row.leads?.email ?? null,
        template_name: row.campaign_templates?.name ?? null,
        action_type: row.action_type,
        status: row.status,
        scheduled_at: row.scheduled_at,
        sent_at: row.sent_at,
        error_message: row.error_message,
        created_at: row.created_at,
        target_stage_name: row.campanha_stages?.name ?? null,
        sdr_name: row.target_sdr_id ? (sdrMap[row.target_sdr_id] ?? null) : null,
      })) as QueueItem[];
    },
    enabled: !!campanhaId && !!status,
    staleTime: 60000,
  });
}

// ─── Pipe queue items ───────────────────────────────────────────────────────

export function usePipeQueueItems(
  organizationId: string | null,
  pipeType: string,
  status: string | null
) {
  return useQuery({
    queryKey: ["pipe_queue_items", organizationId, pipeType, status],
    queryFn: async () => {
      // scheduled_pipe_messages not in generated types — use (supabase as any)
      let query = (supabase as any)
        .from("scheduled_pipe_messages")
        .select(
          `id, action_type, status, scheduled_at, sent_at, error_message, created_at,
           target_stage_id, target_sdr_id, template_id, lead_id`
        )
        .eq("organization_id", organizationId)
        .eq("pipe_type", pipeType)
        .order("scheduled_at", { ascending: false })
        .limit(200);

      if (status) {
        if (status === "scheduled") {
          query = query.in("status", ["scheduled", "processing"]);
        } else {
          query = query.eq("status", status);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data ?? []) as any[];

      // Resolve lead names
      const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))];
      let leadMap: Record<string, { name: string; phone: string | null; email: string | null }> = {};
      if (leadIds.length > 0) {
        const { data: leadData } = await supabase
          .from("leads")
          .select("id, name, phone, email")
          .in("id", leadIds);
        for (const l of leadData ?? []) {
          leadMap[l.id] = { name: l.name, phone: l.phone, email: l.email };
        }
      }

      // Resolve template names
      const templateIds = [...new Set(rows.map((r) => r.template_id).filter(Boolean))];
      let templateMap: Record<string, string> = {};
      if (templateIds.length > 0) {
        const { data: tplData } = await supabase
          .from("campaign_templates")
          .select("id, name")
          .in("id", templateIds);
        for (const t of tplData ?? []) {
          templateMap[t.id] = t.name;
        }
      }

      // Resolve stage names
      const stageIds = [...new Set(rows.map((r) => r.target_stage_id).filter(Boolean))];
      let stageMap: Record<string, string> = {};
      if (stageIds.length > 0) {
        const { data: stageData } = await supabase
          .from("pipeline_stages")
          .select("id, name")
          .in("id", stageIds);
        for (const s of stageData ?? []) {
          stageMap[s.id] = s.name;
        }
      }

      // Resolve SDR names
      const sdrIds = [...new Set(rows.map((r) => r.target_sdr_id).filter(Boolean))];
      let sdrMap: Record<string, string> = {};
      if (sdrIds.length > 0) {
        const { data: sdrData } = await supabase
          .from("team_members")
          .select("id, name")
          .in("id", sdrIds);
        for (const s of sdrData ?? []) {
          sdrMap[s.id] = s.name;
        }
      }

      return rows.map((row) => ({
        id: row.id,
        lead_name: row.lead_id ? (leadMap[row.lead_id]?.name ?? null) : null,
        lead_phone: row.lead_id ? (leadMap[row.lead_id]?.phone ?? null) : null,
        lead_email: row.lead_id ? (leadMap[row.lead_id]?.email ?? null) : null,
        template_name: row.template_id ? (templateMap[row.template_id] ?? null) : null,
        action_type: row.action_type,
        status: row.status,
        scheduled_at: row.scheduled_at,
        sent_at: row.sent_at,
        error_message: row.error_message,
        created_at: row.created_at,
        target_stage_name: row.target_stage_id ? (stageMap[row.target_stage_id] ?? null) : null,
        sdr_name: row.target_sdr_id ? (sdrMap[row.target_sdr_id] ?? null) : null,
      })) as QueueItem[];
    },
    enabled: !!organizationId && !!pipeType && !!status,
    staleTime: 60000,
  });
}

// ─── Retry mutation ─────────────────────────────────────────────────────────

export function useRetryDispatchItems(
  table: "scheduled_campaign_messages" | "scheduled_pipe_messages",
  invalidateKeys: string[][]
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await (supabase as any)
        .from(table)
        .update({
          status: "scheduled",
          error_message: null,
          scheduled_at: new Date().toISOString(),
        })
        .in("id", ids);

      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success("Itens reagendados para reenvio");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao reagendar itens");
    },
  });
}
