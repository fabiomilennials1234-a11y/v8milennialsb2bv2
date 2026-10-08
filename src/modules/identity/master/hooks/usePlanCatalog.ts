/**
 * Catálogo de planos (`subscription_plans`), por chave: nome comercial para a
 * tela (`lib/plan-label.ts`) e preço de lista para o financeiro
 * (`lib/org-finance.ts`). Uma query só, compartilhada pelo painel master.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMasterAuth } from "./useMasterAuth";
import type { PlanCatalogEntry } from "../lib/plan-label";
import type { PlanPricing } from "../lib/org-finance";

export type PlanCatalogRow = PlanCatalogEntry & PlanPricing;

export function usePlanCatalog() {
  const { isMaster } = useMasterAuth();
  return useQuery({
    queryKey: ["master-plan-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select(
          "name, display_name, price_monthly, base_price_monthly, price_per_user_monthly, included_users, extra_user_price, min_users",
        );
      if (error) throw error;
      return new Map(((data ?? []) as PlanCatalogRow[]).map((p) => [p.name, p]));
    },
    enabled: isMaster,
    staleTime: 10 * 60_000,
  });
}
