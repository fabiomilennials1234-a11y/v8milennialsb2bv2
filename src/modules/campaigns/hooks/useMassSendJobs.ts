/**
 * useMassSendJobs — query + realtime + control of uazapi_sender_jobs rows.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import type { Tables } from "@/integrations/supabase/types";

export type UazapiSenderJob = Tables<"uazapi_sender_jobs">;

export function useMassSendJobs() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const qc = useQueryClient();

  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`uazapi_sender_jobs:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "uazapi_sender_jobs",
          filter: `organization_id=eq.${orgId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["uazapi_sender_jobs", orgId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [orgId, qc]);

  return useQuery({
    queryKey: ["uazapi_sender_jobs", orgId],
    queryFn: async (): Promise<UazapiSenderJob[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("uazapi_sender_jobs")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as UazapiSenderJob[];
    },
    enabled: !!orgId,
  });
}

export function useCreateMassSend() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async (input: {
      instance_id: string;
      campaign_id?: string;
      recipients: Array<{ number: string; text?: string }>;
      template_text?: string;
      delay_min_ms?: number;
      delay_max_ms?: number;
      scheduled_for?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("mass-send-create", {
        body: input,
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true; sender_job_id: string; uazapi_sender_id: string };
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["uazapi_sender_jobs", teamMember.organization_id] });
      }
    },
  });
}

export function useControlMassSend() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async ({
      job_id,
      action,
    }: {
      job_id: string;
      action: "pause" | "resume" | "stop";
    }) => {
      const { data, error } = await supabase.functions.invoke("mass-send-control", {
        body: { job_id, action },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true; status: string };
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["uazapi_sender_jobs", teamMember.organization_id] });
      }
    },
  });
}

export function useRefreshMassSendStatus() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async (job_id: string) => {
      const { data, error } = await supabase.functions.invoke("mass-send-status", {
        body: { job_id },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["uazapi_sender_jobs", teamMember.organization_id] });
      }
    },
  });
}
