import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAnalyticsFilters } from "./useAnalyticsFilters";
import { isMissingSchemaError } from "@/lib/rpc-errors";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UtmLevel = "campaign" | "adset" | "ad" | "leads";

export interface UtmGroupedRow {
  name: string;
  meta_id: string | null;
  total_leads: number;
  converted: number;
  conversion_rate: number;
  revenue: number;
}

export interface UtmLeadRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  pipe_status: string;
  responsible: string;
}

export interface MetaInsightRow {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  ctr: number;
}

export interface UtmCombinedRow {
  id: string;
  name: string;
  meta_id: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  totalLeads: number;
  converted: number;
  conversionRate: number;
  revenue: number;
  cpl: number;
  cac: number;
  roas: number;
}

export interface UtmKpis {
  totalLeads: number;
  totalSpend: number;
  avgCpl: number;
  avgConversionRate: number;
  roas: number;
  cac: number;
}

export interface UtmAnalyticsData {
  items: UtmCombinedRow[];
  leads: UtmLeadRow[];
  kpis: UtmKpis;
  level: UtmLevel;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const EMPTY: UtmAnalyticsData = {
  items: [],
  leads: [],
  kpis: { totalLeads: 0, totalSpend: 0, avgCpl: 0, avgConversionRate: 0, roas: 0, cac: 0 },
  level: "campaign",
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalyticsUtms(
  level: UtmLevel,
  campaign?: string | null,
  adset?: string | null,
  ad?: string | null,
  campaignMetaId?: string | null,
  adsetMetaId?: string | null,
) {
  const { organizationId, isReady } = useOrganization();
  const { filters, startStr, endStr } = useAnalyticsFilters();

  return useQuery({
    queryKey: [
      "analytics-utms",
      organizationId,
      startStr,
      endStr,
      filters.memberId,
      level,
      campaign,
      adset,
      ad,
    ],
    queryFn: async (): Promise<UtmAnalyticsData> => {
      // 1. Always call RPC
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_analytics_utm_metrics" as any,
        {
          p_org_id: organizationId,
          p_start_date: startStr,
          p_end_date: endStr,
          p_member_id: filters.memberId,
          p_level: level,
          p_campaign: campaign || null,
          p_adset: adset || null,
          p_ad: ad || null,
        },
      );

      if (rpcError) {
        if (isMissingSchemaError(rpcError)) {
          console.warn("⚠️ [useAnalyticsUtms] RPC ausente (migration pendente?):", rpcError.message);
          return EMPTY;
        }
        console.error("❌ [useAnalyticsUtms] RPC error:", rpcError.message);
        throw new Error(`Analytics UTMs failed: ${rpcError.message}`);
      }

      const rpcResult = Array.isArray(rpcData) && rpcData.length > 0
        ? rpcData[0]
        : rpcData;
      const rpcItems = rpcResult?.items || [];

      // 2. If leads level, return directly
      if (level === "leads") {
        return {
          items: [],
          leads: rpcItems as UtmLeadRow[],
          kpis: EMPTY.kpis,
          level,
        };
      }

      // 3. Fetch Meta Ads insights
      let metaItems: MetaInsightRow[] = [];
      try {
        const metaRes = await supabase.functions.invoke("meta-ads-insights", {
          body: {
            start_date: startStr,
            end_date: endStr,
            level,
            campaign_id: campaignMetaId || null,
            adset_id: adsetMetaId || null,
          },
        });
        if (metaRes.data?.data) {
          metaItems = metaRes.data.data;
        }
      } catch (err) {
        console.warn("⚠️ [useAnalyticsUtms] Meta insights fetch failed:", err);
      }

      // 4. Merge by meta_id
      const metaMap = new Map<string, MetaInsightRow>();
      for (const m of metaItems) {
        metaMap.set(m.id, m);
      }

      const combined: UtmCombinedRow[] = [];
      const rpcGrouped = rpcItems as UtmGroupedRow[];

      // First: match RPC rows to Meta rows by meta_id
      const matchedMetaIds = new Set<string>();
      for (const rpc of rpcGrouped) {
        const meta = rpc.meta_id ? metaMap.get(rpc.meta_id) : null;
        if (meta) matchedMetaIds.add(meta.id);

        const spend = meta?.spend || 0;
        const revenue = rpc.revenue || 0;

        combined.push({
          id: meta?.id || rpc.meta_id || rpc.name,
          name: rpc.name || meta?.name || "—",
          meta_id: rpc.meta_id,
          spend,
          impressions: meta?.impressions || 0,
          clicks: meta?.clicks || 0,
          ctr: meta?.ctr || 0,
          cpc: meta?.cpc || 0,
          totalLeads: rpc.total_leads,
          converted: rpc.converted,
          conversionRate: rpc.conversion_rate,
          revenue,
          cpl: rpc.total_leads > 0 ? spend / rpc.total_leads : 0,
          cac: rpc.converted > 0 ? spend / rpc.converted : 0,
          roas: spend > 0 ? revenue / spend : 0,
        });
      }

      // Add Meta rows that have no matching leads (spend but no leads)
      for (const meta of metaItems) {
        if (!matchedMetaIds.has(meta.id)) {
          combined.push({
            id: meta.id,
            name: meta.name,
            meta_id: meta.id,
            spend: meta.spend,
            impressions: meta.impressions,
            clicks: meta.clicks,
            ctr: meta.ctr,
            cpc: meta.cpc,
            totalLeads: 0,
            converted: 0,
            conversionRate: 0,
            revenue: 0,
            cpl: 0,
            cac: 0,
            roas: 0,
          });
        }
      }

      // 5. Compute KPIs
      const totalLeads = combined.reduce((s, r) => s + r.totalLeads, 0);
      const totalSpend = combined.reduce((s, r) => s + r.spend, 0);
      const totalConverted = combined.reduce((s, r) => s + r.converted, 0);
      const totalRevenue = combined.reduce((s, r) => s + r.revenue, 0);

      const kpis: UtmKpis = {
        totalLeads,
        totalSpend,
        avgCpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
        avgConversionRate: totalLeads > 0 ? (totalConverted / totalLeads) * 100 : 0,
        roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
        cac: totalConverted > 0 ? totalSpend / totalConverted : 0,
      };

      return { items: combined, leads: [], kpis, level };
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
