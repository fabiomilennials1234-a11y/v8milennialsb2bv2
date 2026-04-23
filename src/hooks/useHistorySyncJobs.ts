/**
 * useHistorySyncJobs — query history_sync_jobs with realtime updates.
 *
 * Service-layer: reads directly from Supabase (RLS enforces org membership).
 * Realtime: subscribes to INSERT/UPDATE events and invalidates the query
 * so the dashboard progress bar updates without polling.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type HistorySyncJob = Tables<"history_sync_jobs">;
export type HistorySyncJobInsert = TablesInsert<"history_sync_jobs">;

export type SyncScope = "default" | "full" | "chat";

type JobFilter = {
  instanceId?: string;
  status?: HistorySyncJob["status"];
};

export function useHistorySyncJobs(filter: JobFilter = {}) {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const qc = useQueryClient();

  // Realtime subscription — invalidates query on any change
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`history_sync_jobs:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "history_sync_jobs",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["history_sync_jobs", orgId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, qc]);

  return useQuery({
    queryKey: ["history_sync_jobs", orgId, filter.instanceId ?? null, filter.status ?? null],
    queryFn: async (): Promise<HistorySyncJob[]> => {
      if (!orgId) return [];
      let query = supabase
        .from("history_sync_jobs")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (filter.instanceId) query = query.eq("instance_id", filter.instanceId);
      if (filter.status) query = query.eq("status", filter.status);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as HistorySyncJob[];
    },
    enabled: !!orgId,
  });
}

type CreateJobInput = {
  instance_id: string;
  scope: SyncScope;
  chat_jid?: string | null;
  max_days?: number;
  max_messages_per_chat?: number;
  max_chats?: number;
};

export function useCreateHistorySyncJob() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateJobInput): Promise<HistorySyncJob> => {
      if (!orgId) throw new Error("Usuário não está vinculado a uma organização");
      if (input.scope === "chat" && !input.chat_jid) {
        throw new Error("Scope 'chat' exige chat_jid");
      }
      const payload: HistorySyncJobInsert = {
        organization_id: orgId,
        instance_id: input.instance_id,
        scope: input.scope,
        chat_jid: input.chat_jid ?? null,
        max_days: input.max_days ?? (input.scope === "full" ? 0 : 30),
        max_messages_per_chat: input.max_messages_per_chat ?? 500,
        max_chats: input.max_chats ?? 100,
        status: "queued",
      };
      const { data, error } = await supabase
        .from("history_sync_jobs")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as HistorySyncJob;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["history_sync_jobs", orgId] });
    },
  });
}

type ControlAction = "cancel" | "retry";

export function useControlHistorySyncJob() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      job,
      action,
    }: {
      job: HistorySyncJob;
      action: ControlAction;
    }) => {
      if (!orgId) throw new Error("Usuário não está vinculado a uma organização");
      if (action === "cancel") {
        const { error } = await supabase
          .from("history_sync_jobs")
          .update({ status: "failed", error: "Cancelled by user" })
          .eq("id", job.id)
          .eq("organization_id", orgId);
        if (error) throw error;
        return { ok: true as const };
      }
      // retry — insert a new queued job with same params, reset cursor
      const { error: insertErr } = await supabase.from("history_sync_jobs").insert({
        organization_id: orgId,
        instance_id: job.instance_id,
        scope: job.scope,
        chat_jid: job.chat_jid,
        max_days: job.max_days,
        max_messages_per_chat: job.max_messages_per_chat,
        max_chats: job.max_chats,
        status: "queued",
      });
      if (insertErr) throw insertErr;
      return { ok: true as const };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["history_sync_jobs", orgId] });
    },
  });
}
