/**
 * useNewLeads(range)
 *
 * Conta leads criados (leads.created_at) no range.
 * Retorna total, sparkline diário (buckets do range) e top sources.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { getDailyBuckets, type TVPeriodRange } from "@/lib/tv-periods";

export interface NewLeadsBucket {
  date: Date;
  key: string;
  count: number;
}

export interface NewLeadsSource {
  source: string;
  count: number;
}

export interface NewLeadsData {
  total: number;
  buckets: NewLeadsBucket[];
  topSources: NewLeadsSource[];
  isLoading: boolean;
}

export function useNewLeads(range: TVPeriodRange): NewLeadsData {
  const { organizationId } = useOrganization();

  // Fetch all leads for the current month, filter client-side by range.
  // Avoids PostgREST 400 from duplicate column filters and query key thrashing
  // from the 200ms period tick recalculating end date.
  const monthStart = new Date(range.start.getFullYear(), range.start.getMonth(), 1).toISOString();

  const { data: allLeads = [], isLoading } = useQuery({
    queryKey: ["tv-new-leads", organizationId, monthStart],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("id, created_at, origin")
        .eq("organization_id", organizationId)
        .gte("created_at", monthStart);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const leads = useMemo(() => {
    return allLeads.filter((lead) => {
      const created = lead.created_at ? new Date(lead.created_at) : null;
      if (!created) return false;
      return created >= range.start && created <= range.end;
    });
  }, [allLeads, range.start.getTime(), range.end.getTime()]);

  return useMemo(() => {
    const buckets = getDailyBuckets(range).map((b) => ({ ...b, count: 0 }));
    const bucketByKey = new Map(buckets.map((b) => [b.key, b]));

    const sourceCount = new Map<string, number>();

    for (const lead of leads) {
      const created = lead.created_at ? new Date(lead.created_at) : null;
      if (!created) continue;
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
      const b = bucketByKey.get(key);
      if (b) b.count++;

      const src = ((lead as any).origin ?? "—").toString();
      sourceCount.set(src, (sourceCount.get(src) ?? 0) + 1);
    }

    const topSources: NewLeadsSource[] = Array.from(sourceCount.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    return {
      total: leads.length,
      buckets,
      topSources,
      isLoading,
    };
  }, [leads, range.start.getTime(), range.end.getTime(), isLoading]);
}
