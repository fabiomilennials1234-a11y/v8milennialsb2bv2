import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import type { ProductivitySellerRow } from "@/modules/analytics/lib/productivity-seller";

/**
 * Produtividade — Activity-in-Period Indicator (ADR-0013, PRD #891).
 *
 * OPPOSITE of useFunnelHealth (cohort-by-creation): every count is keyed to the
 * DATE OF THE ACTION ITSELF, never to the Lead's creation/entry date. A Lead
 * created in May whose meeting was booked in June counts in JUNE.
 *
 * RPCs (migration 20261130000000), covered by
 * tests/integration/get-productivity-activity.test.ts:
 *   - get_productivity_activity(org, from, to, seller?)            → 4 counts
 *   - get_productivity_activity_leads(org, from, to, type, seller?) → drill rows
 */

export type ProductivityCountType =
  | "novos_leads"
  | "reunioes_marcadas"
  | "reunioes_realizadas"
  | "vendido";

export interface ProductivityActivity {
  novos_leads: number;
  reunioes_marcadas: number;
  reunioes_realizadas: number;
  vendido: number;
  from: string;
  to: string;
  seller: string | null;
}

export interface ProductivityDrillRow {
  lead_id: string;
  lead_name: string | null;
  company: string | null;
  seller_id: string | null;
  seller_name: string | null;
  action_at: string | null;
}

/** Counts for the [from,to] window, org-wide or narrowed to a single seller. */
export function useProductivityActivity(
  from: string,
  to: string,
  seller: string | null,
) {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["productivity-activity", organizationId, from, to, seller],
    queryFn: async (): Promise<ProductivityActivity | null> => {
      if (!organizationId) return null;
      // RPC nova — fora do types.ts auto-gerado até regen.
      const { data, error } = await supabase.rpc("get_productivity_activity" as never, {
        p_org_id: organizationId,
        p_from: from,
        p_to: to,
        p_seller: seller,
      } as never);
      if (error) throw error;
      return data as unknown as ProductivityActivity;
    },
    enabled: !!organizationId && !!from && !!to,
    staleTime: 60_000,
  });
}

/** Per-Lead drill behind a single count. Only fetches while `enabled` (drill open). */
export function useProductivityDrill(
  countType: ProductivityCountType | null,
  from: string,
  to: string,
  seller: string | null,
) {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["productivity-drill", organizationId, countType, from, to, seller],
    queryFn: async (): Promise<ProductivityDrillRow[]> => {
      if (!organizationId || !countType) return [];
      const { data, error } = await supabase.rpc("get_productivity_activity_leads" as never, {
        p_org_id: organizationId,
        p_from: from,
        p_to: to,
        p_count_type: countType,
        p_seller: seller,
      } as never);
      if (error) throw error;
      return (data as unknown as ProductivityDrillRow[]) ?? [];
    },
    enabled: !!organizationId && !!countType && !!from && !!to,
    staleTime: 30_000,
  });
}

/**
 * Placar por vendedor para o mesmo [from,to] — uma linha por vendedor com
 * atividade no período (marcadas/realizadas/vendido/novos), event-anchored.
 * RPC get_productivity_activity_by_seller (migration 20270201000000).
 */
export function useProductivityBySeller(from: string, to: string) {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["productivity-by-seller", organizationId, from, to],
    queryFn: async (): Promise<ProductivitySellerRow[]> => {
      if (!organizationId) return [];
      const { data, error } = await supabase.rpc(
        "get_productivity_activity_by_seller" as never,
        { p_org_id: organizationId, p_from: from, p_to: to } as never,
      );
      if (error) throw error;
      return (data as unknown as ProductivitySellerRow[]) ?? [];
    },
    enabled: !!organizationId && !!from && !!to,
    staleTime: 60_000,
  });
}
