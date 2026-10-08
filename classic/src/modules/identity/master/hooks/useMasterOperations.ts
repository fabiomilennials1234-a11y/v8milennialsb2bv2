/**
 * Hooks para Operations Center (Master Admin)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────

export interface OperationsOverview {
  jobs_success: number;
  jobs_error: number;
  jobs_total: number;
  orgs_active: number;
}

export interface UsageByOrg {
  organization_id: string;
  organization_name: string;
  total_events: number;
  leads_criados: number;
  cards_movidos: number;
  mensagens_enviadas: number;
  ultima_atividade: string;
}

export interface RuntimeLog {
  id: string;
  organization_id: string | null;
  module: string;
  action: string;
  status: string;
  payload_snapshot: Record<string, unknown> | null;
  error_message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  organization?: { name: string } | null;
}

// ─── RPC 1: Visão Geral ─────────────────────────────────

export function useOperationsOverview(interval: string) {
  return useQuery({
    queryKey: ["master-operations-overview", interval],
    queryFn: async (): Promise<OperationsOverview> => {
      const { data, error } = await supabase.rpc("get_operations_overview", {
        interval_param: interval,
      });
      if (error) throw error;
      return data as unknown as OperationsOverview;
    },
    staleTime: 60_000,
  });
}

// ─── RPC 2: Uso por Organização ──────────────────────────

export function useUsageByOrg(interval: string) {
  return useQuery({
    queryKey: ["master-usage-by-org", interval],
    queryFn: async (): Promise<UsageByOrg[]> => {
      const { data, error } = await supabase.rpc("get_usage_by_org", {
        interval_param: interval,
      });
      if (error) throw error;
      return (data ?? []) as unknown as UsageByOrg[];
    },
    staleTime: 60_000,
  });
}

// ─── Runtime Logs (query direta, paginada) ───────────────

interface RuntimeLogsParams {
  status?: string;
  module?: string;
  interval?: string;
  limit?: number;
  offset?: number;
}

export function useRuntimeLogs(params: RuntimeLogsParams = {}) {
  const { status, module, interval = "24 hours", limit = 50, offset = 0 } = params;

  return useQuery({
    queryKey: ["master-runtime-logs", status, module, interval, limit, offset],
    queryFn: async (): Promise<{ logs: RuntimeLog[]; total: number }> => {
      // Count query
      let countQuery = supabase
        .from("runtime_logs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - parseInterval(interval)).toISOString());

      if (status) countQuery = countQuery.eq("status", status);
      if (module) countQuery = countQuery.eq("module", module);

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;

      // Data query
      let query = supabase
        .from("runtime_logs")
        .select("*, organization:organizations(name)")
        .gte("created_at", new Date(Date.now() - parseInterval(interval)).toISOString())
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq("status", status);
      if (module) query = query.eq("module", module);

      const { data, error } = await query;
      if (error) throw error;

      return { logs: (data ?? []) as unknown as RuntimeLog[], total: count ?? 0 };
    },
    staleTime: 60_000,
  });
}

// ─── Types: Automation Jobs ─────────────────────────────

export interface JobsOverview {
  total: number;
  success: number;
  failed: number;
  dead_letter: number;
  retrying: number;
  running: number;
}

export interface AutomationJob {
  id: string;
  organization_id: string;
  source_engine: string;
  entity_type: string;
  entity_id: string;
  source_table: string | null;
  source_id: string | null;
  action_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  next_retry_at: string | null;
  retry_count: number;
  max_retries: number;
  payload_snapshot: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  organization?: { name: string } | null;
}

// ─── Hook: Jobs Overview ────────────────────────────────

export function useJobsOverview(interval: string) {
  return useQuery({
    queryKey: ["master-jobs-overview", interval],
    queryFn: async (): Promise<JobsOverview> => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-automation-jobs?overview=true&interval=${encodeURIComponent(interval)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

// ─── Hook: Automation Jobs List ─────────────────────────

interface AutomationJobsParams {
  status?: string;
  sourceEngine?: string;
  organizationId?: string;
  interval?: string;
  limit?: number;
  offset?: number;
}

export function useAutomationJobs(params: AutomationJobsParams = {}) {
  const { status, sourceEngine, organizationId, interval = "24 hours", limit = 50, offset = 0 } = params;

  return useQuery({
    queryKey: ["master-automation-jobs", status, sourceEngine, organizationId, interval, limit, offset],
    queryFn: async (): Promise<{ jobs: AutomationJob[]; total: number }> => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const searchParams = new URLSearchParams();
      searchParams.set("interval", interval);
      searchParams.set("limit", String(limit));
      searchParams.set("offset", String(offset));
      if (status) searchParams.set("status", status);
      if (sourceEngine) searchParams.set("source_engine", sourceEngine);
      if (organizationId) searchParams.set("organization_id", organizationId);

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-automation-jobs?${searchParams}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

// ─── Hook: Retry Dead Letter ────────────────────────────

export function useRetryDeadLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string): Promise<{ success: boolean; message: string }> => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retry-dead-letter-jobs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ job_id: jobId }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-automation-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["master-jobs-overview"] });
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────

function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)\s*(hour|day|minute)/i);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("minute")) return value * 60 * 1000;
  if (unit.startsWith("hour")) return value * 60 * 60 * 1000;
  if (unit.startsWith("day")) return value * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}
