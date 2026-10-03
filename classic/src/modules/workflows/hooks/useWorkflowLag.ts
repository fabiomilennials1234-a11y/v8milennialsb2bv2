/**
 * Leitura do Atraso (Lag) do motor de automações — /master/automation-health.
 *
 * Lag = tempo entre a automação FICAR PRONTA pra rodar (Due) e um worker PEGAR ela
 * (Claimed). É a única medida de dor de cliente do motor. Ver CONTEXT.md e ADR-0023.
 *
 * NÃO confundir com Wait: espera programada pelo próprio cliente (nó de delay de
 * 2 dias). Wait é saudável e não entra nesta conta.
 *
 * As três RPCs são SECURITY DEFINER com gate de master DENTRO. O cast existe porque
 * `types.ts` é auto-gerado e só conhece as funções depois da migration aplicada +
 * regeneração — não é para esconder ausência.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
const rpc = supabase as unknown as RpcClient;

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await rpc.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export interface LagByOrg {
  organization_id: string;
  organization_name: string;
  claims: number;
  lag_p50_ms: number | null;
  lag_p90_ms: number | null;
  lag_max_ms: number | null;
}

export interface LagByWorkflow {
  workflow_id: string;
  workflow_name: string;
  organization_name: string;
  claims: number;
  lag_p90_ms: number | null;
}

export interface PoolState {
  mode: "auto" | "pinned";
  size: number;
  min: number;
  max: number;
  budgetMs: number;
  satStreak: number;
  idleStreak: number;
  lastChangeAt: string | null;
}

export function useWorkflowLagByOrg(days = 7) {
  return useQuery({
    queryKey: ["workflow-lag-by-org", days],
    queryFn: () => call<LagByOrg>("master_workflow_lag_by_org", { p_days: days }),
    refetchInterval: 60_000,
  });
}

export function useWorkflowLagByWorkflow(days = 7, limit = 10) {
  return useQuery({
    queryKey: ["workflow-lag-by-workflow", days, limit],
    queryFn: () => call<LagByWorkflow>("master_workflow_lag_by_workflow", { p_days: days, p_limit: limit }),
    refetchInterval: 60_000,
  });
}

export function useWorkflowPoolState() {
  return useQuery({
    queryKey: ["workflow-pool-state"],
    queryFn: async (): Promise<PoolState> => {
      const rows = await call<{ key: string; value: string }>("master_workflow_pool_state");
      const m = new Map(rows.map((r) => [r.key, r.value]));
      const num = (k: string, d: number) => {
        const n = Number(m.get(k));
        return Number.isFinite(n) ? n : d;
      };
      return {
        mode: m.get("workflow_pool_mode") === "pinned" ? "pinned" : "auto",
        size: num("workflow_pool_size", 4),
        min: num("workflow_pool_min", 4),
        max: num("workflow_pool_max", 16),
        budgetMs: num("workflow_run_budget_ms", 45_000),
        satStreak: num("workflow_pool_sat_streak", 0),
        idleStreak: num("workflow_pool_idle_streak", 0),
        lastChangeAt: m.get("workflow_pool_last_change") ?? null,
      };
    },
    refetchInterval: 30_000,
  });
}

/** ms → texto que um humano lê sem converter nada de cabeça. */
export function formatLag(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1).replace(".", ",")} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ${Math.round(s % 60)} s`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

/** Faixa de saúde do Lag. Limiares deliberadamente frouxos: o setor todo enfileira. */
export function lagSeverity(ms: number | null | undefined): "bom" | "atencao" | "ruim" {
  if (ms === null || ms === undefined) return "bom";
  if (ms < 60_000) return "bom";
  if (ms < 5 * 60_000) return "atencao";
  return "ruim";
}
