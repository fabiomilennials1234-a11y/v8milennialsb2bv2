/**
 * Financeiro da central Organizações — fatos de `master_org_finance`, custos
 * unitários de `master_cost_settings` e preço de lista de `subscription_plans`.
 * A conta fica em `lib/org-finance.ts`.
 *
 * Só master pleno: as RPCs recusam outbounder (42501), então a query nem sai.
 * Escrita só pelas RPCs auditadas (migration 20271111000000).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { notifyError } from "@/shared/errors";
import { useMasterAuth } from "./useMasterAuth";
import type { CostSettings, OrgFinanceFacts, PlanPricing } from "../lib/org-finance";

const FINANCE_KEY = ["master-org-finance"] as const;
const COSTS_KEY = ["master-cost-settings"] as const;

// As RPCs (20271111000000) ainda não estão no types.ts gerado.
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: Error | null }>;

const num = (v: unknown) => Number(v ?? 0) || 0;

export function useOrgFinance() {
  const { isFullMaster } = useMasterAuth();
  return useQuery({
    queryKey: FINANCE_KEY,
    queryFn: async () => {
      const { data, error } = await rpc("master_org_finance");
      if (error) throw error;
      // bigint/numeric chegam como string pelo PostgREST.
      const rows = ((data ?? []) as Record<string, unknown>[]).map(
        (r): OrgFinanceFacts => ({
          organization_id: r.organization_id as string,
          monthly_fee_cents: r.monthly_fee_cents == null ? null : num(r.monthly_fee_cents),
          fee_notes: (r.fee_notes as string | null) ?? null,
          fee_updated_at: (r.fee_updated_at as string | null) ?? null,
          uazapi_chips: num(r.uazapi_chips),
          llm_input_tokens_30d: num(r.llm_input_tokens_30d),
          llm_output_tokens_30d: num(r.llm_output_tokens_30d),
          client_revenue_30d: num(r.client_revenue_30d),
          client_sales_30d: num(r.client_sales_30d),
        }),
      );
      return new Map(rows.map((r) => [r.organization_id, r]));
    },
    enabled: isFullMaster,
    staleTime: 60_000,
  });
}

export function useCostSettings() {
  const { isFullMaster } = useMasterAuth();
  return useQuery({
    queryKey: COSTS_KEY,
    queryFn: async (): Promise<CostSettings> => {
      const { data, error } = await rpc("master_get_cost_settings");
      if (error) throw error;
      const r = ((data ?? []) as Record<string, unknown>[])[0] ?? {};
      return {
        chip_monthly_cents: num(r.chip_monthly_cents),
        infra_fixed_monthly_cents: num(r.infra_fixed_monthly_cents),
        llm_input_usd_per_mtok: num(r.llm_input_usd_per_mtok),
        llm_output_usd_per_mtok: num(r.llm_output_usd_per_mtok),
        usd_brl: num(r.usd_brl),
      };
    },
    enabled: isFullMaster,
    staleTime: 5 * 60_000,
  });
}

export function usePlanPricing() {
  const { isFullMaster } = useMasterAuth();
  return useQuery({
    queryKey: ["master-plan-pricing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select(
          "name, price_monthly, base_price_monthly, price_per_user_monthly, included_users, extra_user_price, min_users",
        );
      if (error) throw error;
      return new Map(((data ?? []) as PlanPricing[]).map((p) => [p.name, p]));
    },
    enabled: isFullMaster,
    staleTime: 10 * 60_000,
  });
}

/** `feeCents` null apaga o contrato: a org volta a ser estimada pela tabela. */
export function useSetOrgMonthlyFee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { orgId: string; feeCents: number | null; notes: string | null }) => {
      const { error } = await rpc("master_set_org_monthly_fee", {
        _org_id: v.orgId,
        _fee_cents: v.feeCents,
        _notes: v.notes,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: FINANCE_KEY });
      toast.success(v.feeCents === null ? "Mensalidade volta a ser estimada pela tabela." : "Mensalidade salva.");
    },
    onError: (error) => notifyError(error, { fallback: "Não foi possível salvar a mensalidade." }),
  });
}

export function useSetCostSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (s: CostSettings) => {
      const { error } = await rpc("master_set_cost_settings", {
        _chip_monthly_cents: s.chip_monthly_cents,
        _infra_fixed_monthly_cents: s.infra_fixed_monthly_cents,
        _llm_input_usd_per_mtok: s.llm_input_usd_per_mtok,
        _llm_output_usd_per_mtok: s.llm_output_usd_per_mtok,
        _usd_brl: s.usd_brl,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COSTS_KEY });
      toast.success("Custos salvos.");
    },
    onError: (error) => notifyError(error, { fallback: "Não foi possível salvar os custos." }),
  });
}
