/**
 * Onda 2 Fase E — hooks pra dashboard /master/automation-health
 *
 * Consolida 4 hooks que alimentam tabs do dashboard:
 *   - useAutomationHealth: stats agregadas (4 categorias)
 *   - useDeadLetterJobs: lista pending_ai_actions dead_letter
 *   - useFailedWorkflows: workflow_executions failed + step error
 *   - useStuckActions: pending_ai_actions órfãs >1h
 *   - useCircuitBrokenWebhooks: webhooks is_active=false
 *   - useSystemAlerts: lista + resolve
 *   - useReprocessJob: invoca edge function reprocess-job
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ─── Stats agregadas ─────────────────────────────────────────────────────────

export interface HealthStats {
  dead_letter_count: number;
  failed_workflows_count: number;
  stuck_actions_count: number;
  circuit_broken_webhooks: number;
  unresolved_alerts: number;
}

export function useAutomationHealth() {
  return useQuery({
    queryKey: ["automation-health"],
    queryFn: async (): Promise<HealthStats> => {
      const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const since1h = new Date(Date.now() - 3600 * 1000).toISOString();

      const [dlq, wfFail, stuck, webhooks, alerts] = await Promise.all([
        supabase.from("pending_ai_actions").select("id", { count: "exact", head: true }).eq("status", "dead_letter").gte("created_at", since24h),
        supabase.from("workflow_executions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("started_at", since24h),
        supabase.from("pending_ai_actions").select("id", { count: "exact", head: true }).eq("status", "pending").lt("created_at", since1h),
        supabase.from("webhooks").select("id", { count: "exact", head: true }).eq("is_active", false),
        supabase.from("system_alerts").select("id", { count: "exact", head: true }).is("resolved_at", null),
      ]);

      return {
        dead_letter_count: dlq.count ?? 0,
        failed_workflows_count: wfFail.count ?? 0,
        stuck_actions_count: stuck.count ?? 0,
        circuit_broken_webhooks: webhooks.count ?? 0,
        unresolved_alerts: alerts.count ?? 0,
      };
    },
    refetchInterval: 30_000,
  });
}

// ─── Dead-letter pending_ai_actions ──────────────────────────────────────────

export function useDeadLetterJobs(limit = 50) {
  return useQuery({
    queryKey: ["dead-letter-jobs", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_ai_actions")
        .select("id, organization_id, lead_id, action_type, error_message, retry_count, created_at, processed_at")
        .eq("status", "dead_letter")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ─── Failed workflows ────────────────────────────────────────────────────────

export function useFailedWorkflows(limit = 50) {
  return useQuery({
    queryKey: ["failed-workflows", limit],
    queryFn: async () => {
      const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("workflow_executions")
        .select("id, workflow_id, organization_id, lead_id, error, current_node_id, started_at, completed_at, workflows!inner(name)")
        .eq("status", "failed")
        .gte("started_at", since7d)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ─── Stuck actions (pending órfãs) ───────────────────────────────────────────

export function useStuckActions(limit = 50) {
  return useQuery({
    queryKey: ["stuck-actions", limit],
    queryFn: async () => {
      const since1h = new Date(Date.now() - 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("pending_ai_actions")
        .select("id, organization_id, lead_id, action_type, retry_count, next_retry_at, created_at")
        .eq("status", "pending")
        .lt("created_at", since1h)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ─── Circuit-broken webhooks ─────────────────────────────────────────────────

export function useCircuitBrokenWebhooks() {
  return useQuery({
    queryKey: ["circuit-broken-webhooks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhooks")
        .select("id, organization_id, name, url, consecutive_failures, disabled_reason, updated_at")
        .eq("is_active", false)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ─── System alerts ───────────────────────────────────────────────────────────

export interface SystemAlert {
  id: string;
  organization_id: string | null;
  severity: "info" | "warning" | "error" | "critical";
  category: string;
  source_type: string | null;
  source_id: string | null;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface UseSystemAlertsOpts {
  category?: string;
  resolved?: boolean;
  organizationId?: string;
  limit?: number;
}

export function useSystemAlerts(opts: UseSystemAlertsOpts = {}) {
  return useQuery({
    queryKey: ["system-alerts", opts],
    queryFn: async (): Promise<SystemAlert[]> => {
      let q = supabase
        .from("system_alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(opts.limit ?? 100);

      if (opts.category) q = q.eq("category", opts.category);
      if (opts.resolved === false) q = q.is("resolved_at", null);
      if (opts.resolved === true) q = q.not("resolved_at", "is", null);
      if (opts.organizationId) q = q.eq("organization_id", opts.organizationId);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SystemAlert[];
    },
    refetchInterval: 60_000,
  });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("system_alerts")
        .update({ resolved_at: new Date().toISOString(), resolved_by: user?.id ?? null })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system-alerts"] });
      qc.invalidateQueries({ queryKey: ["automation-health"] });
    },
  });
}

// ─── Reprocess job (invoke edge fn) ──────────────────────────────────────────

export type ReprocessType = "pending_ai_action" | "workflow_execution" | "automation_job";

export function useReprocessJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { type: ReprocessType; id: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const res = await fetch(`${SUPABASE_URL}/functions/v1/reprocess-job`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dead-letter-jobs"] });
      qc.invalidateQueries({ queryKey: ["failed-workflows"] });
      qc.invalidateQueries({ queryKey: ["stuck-actions"] });
      qc.invalidateQueries({ queryKey: ["automation-health"] });
    },
  });
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export interface AuditLogFilter {
  tableName?: string;
  operation?: "INSERT" | "UPDATE" | "DELETE";
  organizationId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export function useAuditLog(filter: AuditLogFilter = {}) {
  return useQuery({
    queryKey: ["audit-log", filter],
    queryFn: async () => {
      let q = supabase
        .from("audit_log")
        .select("id, table_name, operation, row_id, organization_id, actor_role, actor_function, changes, occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(filter.limit ?? 100);

      if (filter.tableName) q = q.eq("table_name", filter.tableName);
      if (filter.operation) q = q.eq("operation", filter.operation);
      if (filter.organizationId) q = q.eq("organization_id", filter.organizationId);
      if (filter.fromDate) q = q.gte("occurred_at", filter.fromDate);
      if (filter.toDate) q = q.lte("occurred_at", filter.toDate);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
