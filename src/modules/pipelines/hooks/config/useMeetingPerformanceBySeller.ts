/**
 * Performance de reuniões por pré-vendedor, contada por DATA DO EVENTO
 * (não por coorte de criação do lead — diferente da aba Saúde).
 *
 * Fonte: `lead_history` (eventos estruturados `meeting_scheduled` /
 * `meeting_attended`). Atribuição ao pré-vendedor via `leads.pre_sale_responsible_id`
 * (mesma regra de crédito da matriz "Pré-vendas × etapas" da Saúde).
 *
 * "Não compareceram" = Marcadas − Compareceram na janela (def. da Saúde
 * "Reuniões perdidas"); clampado em 0 (comparecimentos podem referir-se a
 * reuniões marcadas antes do recorte).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

export interface MeetingPerfRange {
  start: Date;
  end: Date;
}

export interface MeetingSellerPerf {
  sellerId: string | null;
  marcadas: number;
  compareceram: number;
  naoCompareceram: number;
}

export function useMeetingPerformanceBySeller(range: MeetingPerfRange | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: [
      "meeting-perf-by-seller",
      range?.start.toISOString() ?? "all",
      range?.end.toISOString() ?? "all",
      organizationId,
    ],
    queryFn: async (): Promise<MeetingSellerPerf[]> => {
      if (!organizationId) return [];

      let query = supabase
        .from("lead_history")
        .select("action, lead:leads!inner(pre_sale_responsible_id)")
        .eq("organization_id", organizationId)
        .in("action", ["meeting_scheduled", "meeting_attended"]);

      if (range) {
        query = query
          .gte("created_at", range.start.toISOString())
          .lte("created_at", range.end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      const agg = new Map<string, { marcadas: number; compareceram: number }>();
      for (const row of (data ?? []) as Array<{
        action: string;
        lead: { pre_sale_responsible_id: string | null } | null;
      }>) {
        const sellerId = row.lead?.pre_sale_responsible_id ?? "__none__";
        const cur = agg.get(sellerId) ?? { marcadas: 0, compareceram: 0 };
        if (row.action === "meeting_scheduled") cur.marcadas += 1;
        else cur.compareceram += 1;
        agg.set(sellerId, cur);
      }

      return Array.from(agg.entries())
        .map(([sellerId, v]) => ({
          sellerId: sellerId === "__none__" ? null : sellerId,
          marcadas: v.marcadas,
          compareceram: v.compareceram,
          naoCompareceram: Math.max(0, v.marcadas - v.compareceram),
        }))
        .sort((a, b) => b.marcadas - a.marcadas);
    },
    enabled: isReady && !!organizationId,
    staleTime: 60_000,
  });
}
