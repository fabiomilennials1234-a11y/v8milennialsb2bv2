---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-24-utms-analytics.md
---

# UTMs Analytics Tab - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "UTMs" tab to Analytics that shows Meta Ads leads with drill-down by Campaign → Ad Set → Ad → Individual Leads, with Meta Ads spend data cross-referenced.

**Architecture:** Postgres RPC aggregates leads by UTM fields, a Deno Edge Function fetches Meta Ads insights, and a React Query hook merges both datasets client-side. The meta-webhook is enriched to auto-capture campaign/adset/ad IDs on new leads (Milennials org only).

**Tech Stack:** PostgreSQL (RPC), Supabase Edge Functions (Deno), React + React Query, Tailwind CSS, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-24-utms-analytics-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260324000001_analytics_utm_rpc.sql` | RPC function + indexes + new columns on leads |
| `supabase/functions/meta-ads-insights/index.ts` | Edge Function: fetch Meta Ads insights from Graph API |
| `src/hooks/useAnalyticsUtms.ts` | React Query hook: calls RPC + Edge Function, merges data |
| `src/components/analytics/tabs/UtmsTab.tsx` | Tab container with drill-down state |
| `src/components/analytics/charts/UtmBreadcrumb.tsx` | Breadcrumb navigation for drill-down levels |
| `src/components/analytics/charts/UtmKpiCards.tsx` | 6 KPI summary cards |
| `src/components/analytics/charts/UtmDataTable.tsx` | Shared sortable table for campaign/adset/ad levels (consolidates spec's 3 separate table files - same columns/behavior) |
| `src/components/analytics/charts/UtmLeadsList.tsx` | Final level: list of individual leads |

### Modified Files
| File | Change |
|------|--------|
| `supabase/functions/meta-webhook/index.ts` | Add UTM enrichment via Graph API in `processLeadgen()` (Milennials only) |
| `src/pages/Analytics.tsx` | Add UTMs tab (gated to Milennials org) |
| `src/integrations/supabase/types.ts` | Add `meta_campaign_id`, `meta_adset_id`, `meta_ad_id` to leads types |

---

## Task 1: Database Migration - New Columns + RPC + Indexes

**Files:**
- Create: `supabase/migrations/20260324000001_analytics_utm_rpc.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- ============================================================================
-- UTM Analytics: new columns, indexes, and RPC function
-- ============================================================================

-- 1. Add Meta ID columns to leads for matching by ID
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_campaign_id text,
  ADD COLUMN IF NOT EXISTS meta_adset_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_id text;

-- 2. Partial index for UTM analytics queries
CREATE INDEX IF NOT EXISTS idx_leads_org_origin_utm
  ON public.leads (organization_id, created_at)
  WHERE origin = 'meta_ads' AND utm_campaign IS NOT NULL;

-- 3. RPC function
CREATE OR REPLACE FUNCTION public.get_analytics_utm_metrics(
  p_org_id    uuid,
  p_start_date date,
  p_end_date   date,
  p_member_id  uuid    DEFAULT NULL,
  p_level      text    DEFAULT 'campaign',
  p_campaign   text    DEFAULT NULL,
  p_adset      text    DEFAULT NULL,
  p_ad         text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- ── Leads level: return individual leads ──
  IF p_level = 'leads' THEN
    SELECT jsonb_build_object('items', COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb))
    INTO v_result
    FROM (
      SELECT
        l.id,
        l.name,
        l.email,
        l.phone,
        l.created_at,
        COALESCE(
          (SELECT pw.status FROM pipe_whatsapp pw WHERE pw.lead_id = l.id ORDER BY pw.created_at DESC LIMIT 1),
          'sem pipe'
        ) AS pipe_status,
        COALESCE(
          (SELECT tm.name FROM team_members tm WHERE tm.id = l.responsible_id),
          'Não atribuído'
        ) AS responsible,
        COALESCE(l.rating, 0) AS rating
      FROM leads l
      WHERE l.organization_id = p_org_id
        AND l.origin = 'meta_ads'
        AND l.created_at >= p_start_date::timestamp
        AND l.created_at < (p_end_date + 1)::timestamp
        AND l.utm_campaign IS NOT NULL
        AND (p_member_id IS NULL OR l.responsible_id = p_member_id)
        AND (p_campaign IS NULL OR l.utm_campaign = p_campaign)
        AND (p_adset IS NULL OR l.utm_content = p_adset)
        AND (p_ad IS NULL OR l.utm_term = p_ad)
      ORDER BY l.created_at DESC
    ) t;

    RETURN v_result;
  END IF;

  -- ── Aggregated levels: campaign / adset / ad ──
  WITH filtered_leads AS (
    SELECT
      l.id,
      l.utm_campaign,
      l.utm_content,
      l.utm_term,
      l.meta_campaign_id,
      l.meta_adset_id,
      l.meta_ad_id,
      l.rating,
      l.responsible_id
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND l.origin = 'meta_ads'
      AND l.created_at >= p_start_date::timestamp
      AND l.created_at < (p_end_date + 1)::timestamp
      AND l.utm_campaign IS NOT NULL
      AND (p_member_id IS NULL OR l.responsible_id = p_member_id)
      AND (p_campaign IS NULL OR l.utm_campaign = p_campaign)
      AND (p_adset IS NULL OR l.utm_content = p_adset)
      AND (p_ad IS NULL OR l.utm_term = p_ad)
  ),
  lead_proposals AS (
    SELECT
      pp.lead_id,
      pp.status,
      COALESCE(pp.sale_value, 0) AS sale_value
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.lead_id IN (SELECT id FROM filtered_leads)
  ),
  grouped AS (
    SELECT
      CASE p_level
        WHEN 'campaign' THEN fl.utm_campaign
        WHEN 'adset'    THEN fl.utm_content
        WHEN 'ad'       THEN fl.utm_term
      END AS name,
      CASE p_level
        WHEN 'campaign' THEN fl.meta_campaign_id
        WHEN 'adset'    THEN fl.meta_adset_id
        WHEN 'ad'       THEN fl.meta_ad_id
      END AS meta_id,
      COUNT(DISTINCT fl.id) AS total_leads,
      COUNT(DISTINCT CASE WHEN lp.status = 'vendido' THEN fl.id END) AS converted,
      COALESCE(SUM(CASE WHEN lp.status = 'vendido' THEN lp.sale_value ELSE 0 END), 0) AS revenue,
      ROUND(AVG(fl.rating) FILTER (WHERE fl.rating IS NOT NULL), 1) AS avg_rating
    FROM filtered_leads fl
    LEFT JOIN lead_proposals lp ON lp.lead_id = fl.id
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(
      jsonb_build_object(
        'name', g.name,
        'meta_id', g.meta_id,
        'total_leads', g.total_leads,
        'converted', g.converted,
        'conversion_rate', CASE WHEN g.total_leads > 0
          THEN ROUND((g.converted::numeric / g.total_leads) * 100, 1)
          ELSE 0 END,
        'revenue', g.revenue,
        'avg_rating', COALESCE(g.avg_rating, 0)
      )
      ORDER BY g.total_leads DESC
    ), '[]'::jsonb)
  ) INTO v_result
  FROM grouped g;

  RETURN v_result;
END;
$$;
```

- [ ] **Step 2: Verify migration file is valid**

Run: `cat supabase/migrations/20260324000001_analytics_utm_rpc.sql | head -5`
Expected: Shows the first lines of the migration file.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260324000001_analytics_utm_rpc.sql
git commit -m "feat(analytics): add UTM metrics RPC, indexes, and meta ID columns"
```

---

## Task 2: Edge Function - Meta Ads Insights

**Files:**
- Create: `supabase/functions/meta-ads-insights/index.ts`

**Reference patterns:** `supabase/functions/list-lead-forms/index.ts` for structure, `supabase/functions/_shared/meta-api.ts` line 8 for `GRAPH_API_VERSION = "v21.0"`

- [ ] **Step 1: Write the Edge Function**

```typescript
/**
 * meta-ads-insights
 *
 * Fetches campaign/adset/ad level insights from Meta Ads Graph API.
 * Used by the UTMs Analytics tab.
 *
 * Body (POST):
 *   {
 *     start_date: string,   // "YYYY-MM-DD"
 *     end_date: string,     // "YYYY-MM-DD"
 *     level: "campaign" | "adset" | "ad",
 *     campaign_id?: string, // required when level = "adset"
 *     adset_id?: string     // required when level = "ad"
 *   }
 *
 * Response: { data: [...] }
 */

import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface MetaInsightRow {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend: string;
  impressions: string;
  clicks: string;
  cpc?: string;
  ctr?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
}

Deno.serve(withSentry("meta-ads-insights", async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  const headers = withSecurityHeaders({
    ...corsHeaders,
    "Content-Type": "application/json",
  });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Validate anon-key auth
    const authHeader = req.headers.get("authorization");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!authHeader || !anonKey || authHeader !== `Bearer ${anonKey}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers }
      );
    }

    const accessToken = Deno.env.get("META_ADS_ACCESS_TOKEN");
    const accountId = Deno.env.get("META_ADS_ACCOUNT_ID");

    if (!accessToken || !accountId) {
      return new Response(
        JSON.stringify({ error: "Meta Ads credentials not configured" }),
        { status: 500, headers }
      );
    }

    const body = await req.json();
    const { start_date, end_date, level, campaign_id, adset_id } = body;

    if (!start_date || !end_date || !level) {
      return new Response(
        JSON.stringify({ error: "start_date, end_date, and level are required" }),
        { status: 400, headers }
      );
    }

    // Build fields based on level
    const levelFields: Record<string, string> = {
      campaign: "campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr,actions,action_values",
      adset: "adset_id,adset_name,spend,impressions,clicks,cpc,ctr,actions,action_values",
      ad: "ad_id,ad_name,spend,impressions,clicks,cpc,ctr,actions,action_values",
    };

    const fields = levelFields[level];
    if (!fields) {
      return new Response(
        JSON.stringify({ error: "level must be campaign, adset, or ad" }),
        { status: 400, headers }
      );
    }

    // Build filtering
    const filtering: Array<Record<string, string>> = [];
    if (level === "adset" && campaign_id) {
      filtering.push({ field: "campaign.id", operator: "EQUAL", value: campaign_id });
    }
    if (level === "ad" && adset_id) {
      filtering.push({ field: "adset.id", operator: "EQUAL", value: adset_id });
    }

    // Fetch all pages of results
    const allRows: MetaInsightRow[] = [];
    let url: string | null = buildInsightsUrl(accountId, accessToken, {
      level,
      fields,
      start_date,
      end_date,
      filtering,
    });

    while (url) {
      const res = await fetch(url);
      const json = await res.json();

      if (json.error) {
        console.error("[meta-ads-insights] Graph API error:", json.error);
        return new Response(
          JSON.stringify({ error: json.error.message }),
          { status: 502, headers }
        );
      }

      if (json.data) {
        allRows.push(...json.data);
      }

      url = json.paging?.next || null;
    }

    // Normalize response
    const data = allRows.map((row) => ({
      id: row.campaign_id || row.adset_id || row.ad_id || "",
      name: row.campaign_name || row.adset_name || row.ad_name || "",
      spend: parseFloat(row.spend || "0"),
      impressions: parseInt(row.impressions || "0", 10),
      clicks: parseInt(row.clicks || "0", 10),
      cpc: parseFloat(row.cpc || "0"),
      ctr: parseFloat(row.ctr || "0"),
    }));

    await logRuntime({
      module: "analytics",
      action: "meta_ads_insights",
      status: "success",
      payloadSnapshot: { level, rows: data.length },
    });

    return new Response(JSON.stringify({ data }), { status: 200, headers });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[meta-ads-insights] Error:", errorMessage);
    await logRuntime({
      module: "analytics",
      action: "meta_ads_insights",
      status: "error",
      errorMessage,
    });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers }
    );
  }
}));

function buildInsightsUrl(
  accountId: string,
  accessToken: string,
  params: {
    level: string;
    fields: string;
    start_date: string;
    end_date: string;
    filtering: Array<Record<string, string>>;
  }
): string {
  const timeRange = JSON.stringify({ since: params.start_date, until: params.end_date });
  const url = new URL(`${GRAPH_API_BASE}/${accountId}/insights`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("level", params.level);
  url.searchParams.set("fields", params.fields);
  url.searchParams.set("time_range", timeRange);
  url.searchParams.set("limit", "100");
  if (params.filtering.length > 0) {
    url.searchParams.set("filtering", JSON.stringify(params.filtering));
  }
  return url.toString();
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/meta-ads-insights/index.ts
git commit -m "feat(analytics): add meta-ads-insights Edge Function"
```

---

## Task 3: Webhook Enrichment - Auto-capture UTMs for Milennials

**Files:**
- Modify: `supabase/functions/meta-webhook/index.ts` (around line 340, inside `processLeadgen`)

**CRITICAL: This change ONLY runs for the Milennials org. It is wrapped in try/catch. It NEVER blocks lead creation. For all other orgs, zero code change in the execution path.**

- [ ] **Step 1: Read the current processLeadgen function**

Read: `supabase/functions/meta-webhook/index.ts` lines 340-520

- [ ] **Step 2: Add the UTM enrichment function**

Add this helper function BEFORE `processLeadgen` (around line 338):

```typescript
// ── UTM Enrichment (Milennials only) ─────────────────────────────────────

const MILENNIALS_ORG_ID = Deno.env.get("MILENNIALS_ORG_ID") || "";
const META_ADS_ACCESS_TOKEN_ENV = Deno.env.get("META_ADS_ACCESS_TOKEN") || "";
const GRAPH_API_VERSION_UTM = "v21.0";

/**
 * Attempts to fetch campaign/adset/ad names from Meta Graph API
 * for a given leadgen event. Returns UTM fields to merge into the lead.
 * NEVER throws - returns empty object on any failure.
 */
async function enrichUtmFromLeadgen(
  leadgenId: string
): Promise<Record<string, string>> {
  try {
    if (!META_ADS_ACCESS_TOKEN_ENV) return {};

    // Step 1: Get ad_id from leadgen
    const leadgenRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION_UTM}/${leadgenId}?fields=ad_id&access_token=${META_ADS_ACCESS_TOKEN_ENV}`
    );
    const leadgenJson = await leadgenRes.json();
    const adId = leadgenJson?.ad_id;
    if (!adId) return {};

    // Step 2: Get campaign/adset/ad hierarchy from ad
    const adRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION_UTM}/${adId}?fields=name,adset{id,name},campaign{id,name}&access_token=${META_ADS_ACCESS_TOKEN_ENV}`
    );
    const adJson = await adRes.json();
    if (adJson.error) return {};

    return {
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: adJson.campaign?.name || "",
      utm_content: adJson.adset?.name || "",
      utm_term: adJson.name || "",
      meta_campaign_id: adJson.campaign?.id || "",
      meta_adset_id: adJson.adset?.id || "",
      meta_ad_id: adId,
    };
  } catch (err) {
    console.warn(`[meta-webhook] UTM enrichment failed (non-fatal):`, err);
    return {};
  }
}
```

- [ ] **Step 3: Call the enrichment inside processLeadgen**

In the `processLeadgen` function, add the enrichment call AFTER the `applyFieldMappings` call (line ~391) and BEFORE the "Verificar se lead ja existe" section (line ~398).

Find this block (around line 393-396):
```typescript
  const name = mappedFields.name || "Lead Meta Ads";
  const email = mappedFields.email || null;
  const phone = mappedFields.phone || null;
```

Insert AFTER it:

```typescript
  // ── UTM Enrichment (Milennials org only, never blocks lead creation) ──
  let utmFields: Record<string, string> = {};
  if (page.organization_id === MILENNIALS_ORG_ID && MILENNIALS_ORG_ID) {
    utmFields = await enrichUtmFromLeadgen(leadgenId);
  }
```

- [ ] **Step 4: Apply UTM fields to both new lead and existing lead update**

In the existing lead UPDATE block (around line 428-438), add UTM fields that aren't already set. Find:

```typescript
    const updateData: Record<string, unknown> = {
      metadata: { ...formFields, leadgen_id: leadgenId, form_id: leadData.form_id },
    };
```

Add AFTER the existing field updates (after line 436 `if (mappedFields.notes) updateData.notes = mappedFields.notes;`):

```typescript
    // Apply UTM enrichment fields (only if not already set on lead)
    for (const [key, value] of Object.entries(utmFields)) {
      if (value && !mappedFields[key]) {
        updateData[key] = value;
      }
    }
```

In the new lead creation block (around line 443-457), add UTM fields. Find:

```typescript
  const newLeadData: Record<string, unknown> = {
    organization_id: page.organization_id,
    name,
    email,
    phone,
    origin: "meta_ads",
    metadata: { ...formFields, leadgen_id: leadgenId, form_id: leadData.form_id },
  };
```

Add AFTER the metadata line and BEFORE the "Adicionar campos extras mapeados" loop:

```typescript
  // Apply UTM enrichment fields (only if not already set via field_mappings)
  for (const [key, value] of Object.entries(utmFields)) {
    if (value && !mappedFields[key]) {
      newLeadData[key] = value;
    }
  }
```

- [ ] **Step 5: Add meta ID fields to MAPPABLE_LEAD_FIELDS**

Find `MAPPABLE_LEAD_FIELDS` (line 289):

```typescript
const MAPPABLE_LEAD_FIELDS = new Set([
  "name", "email", "phone", "company", "segment", "urgency",
  "faturamento", "notes", "utm_campaign", "utm_source", "utm_medium",
  "utm_content", "utm_term",
]);
```

Replace with:

```typescript
const MAPPABLE_LEAD_FIELDS = new Set([
  "name", "email", "phone", "company", "segment", "urgency",
  "faturamento", "notes", "utm_campaign", "utm_source", "utm_medium",
  "utm_content", "utm_term", "meta_campaign_id", "meta_adset_id", "meta_ad_id",
]);
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/meta-webhook/index.ts
git commit -m "feat(webhook): add UTM enrichment for Milennials org leads

Fetches campaign/adset/ad names from Meta Graph API when a leadgen
event arrives for the Milennials organization. Fully isolated in
try/catch, never blocks lead creation. No behavior change for other orgs."
```

---

## Task 4: Update TypeScript Types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Add meta ID fields to leads Row type**

Find the leads Row type (search for `utm_term: string | null` in the leads section, around line 3300). After `utm_term`, add:

```typescript
      meta_campaign_id: string | null
      meta_adset_id: string | null
      meta_ad_id: string | null
```

- [ ] **Step 2: Add to Insert type**

Find leads Insert type (same pattern, after `utm_term`). Add:

```typescript
      meta_campaign_id?: string | null
      meta_adset_id?: string | null
      meta_ad_id?: string | null
```

- [ ] **Step 3: Add to Update type**

Find leads Update type. Add:

```typescript
      meta_campaign_id?: string | null
      meta_adset_id?: string | null
      meta_ad_id?: string | null
```

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "feat(types): add meta_campaign_id, meta_adset_id, meta_ad_id to leads"
```

---

## Task 5: React Query Hook - useAnalyticsUtms

**Files:**
- Create: `src/hooks/useAnalyticsUtms.ts`

**Reference:** `src/hooks/useAnalyticsEngajamento.ts` for the pattern.

- [ ] **Step 1: Write the hook**

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useAnalyticsFilters } from "./useAnalyticsFilters";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UtmLevel = "campaign" | "adset" | "ad" | "leads";

export interface UtmGroupedRow {
  name: string;
  meta_id: string | null;
  total_leads: number;
  converted: number;
  conversion_rate: number;
  revenue: number;
  avg_rating: number;
}

export interface UtmLeadRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  pipe_status: string;
  responsible: string;
  rating: number;
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
  avgRating: number;
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
        console.error("❌ [useAnalyticsUtms] RPC error:", rpcError.message);
        return EMPTY;
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
          name: rpc.name || meta?.name || "-",
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
          avgRating: rpc.avg_rating,
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
            avgRating: 0,
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
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAnalyticsUtms.ts
git commit -m "feat(analytics): add useAnalyticsUtms hook"
```

---

## Task 6: UI Components - Breadcrumb, KPI Cards, Data Table, Leads List

**Files:**
- Create: `src/components/analytics/charts/UtmBreadcrumb.tsx`
- Create: `src/components/analytics/charts/UtmKpiCards.tsx`
- Create: `src/components/analytics/charts/UtmDataTable.tsx`
- Create: `src/components/analytics/charts/UtmLeadsList.tsx`

**Reference:** `src/components/analytics/charts/AttributionTable.tsx` for table patterns, `src/components/analytics/charts/EngagementKPIs.tsx` for KPI card patterns.

- [ ] **Step 1: Write UtmBreadcrumb**

```tsx
import { ChevronRight } from "lucide-react";
import type { UtmLevel } from "@/hooks/useAnalyticsUtms";

interface BreadcrumbItem {
  label: string;
  level: UtmLevel;
  value?: string;
}

interface Props {
  level: UtmLevel;
  campaign?: string | null;
  adset?: string | null;
  ad?: string | null;
  onNavigate: (level: UtmLevel, campaign?: string | null, adset?: string | null) => void;
}

export function UtmBreadcrumb({ level, campaign, adset, ad, onNavigate }: Props) {
  const items: BreadcrumbItem[] = [
    { label: "Campanhas", level: "campaign" },
  ];

  if (campaign && (level === "adset" || level === "ad" || level === "leads")) {
    items.push({ label: campaign, level: "adset", value: campaign });
  }
  if (adset && (level === "ad" || level === "leads")) {
    items.push({ label: adset, level: "ad", value: adset });
  }
  if (ad && level === "leads") {
    items.push({ label: ad, level: "leads" });
  }

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const isClickable = !isLast;

        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
            {isClickable ? (
              <button
                onClick={() => {
                  if (item.level === "campaign") onNavigate("campaign");
                  if (item.level === "adset") onNavigate("adset", campaign);
                  if (item.level === "ad") onNavigate("ad", campaign, adset);
                }}
                className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
              >
                {item.label}
              </button>
            ) : (
              <span className="text-foreground font-medium">{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write UtmKpiCards**

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Users, DollarSign, Target, TrendingUp, ArrowDownRight, Percent } from "lucide-react";
import type { UtmKpis } from "@/hooks/useAnalyticsUtms";

interface Props {
  kpis: UtmKpis;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });
}

export function UtmKpiCards({ kpis }: Props) {
  const cards = [
    {
      label: "Total de Leads",
      value: kpis.totalLeads.toLocaleString("pt-BR"),
      icon: Users,
    },
    {
      label: "Total Investido",
      value: formatCurrency(kpis.totalSpend),
      icon: DollarSign,
    },
    {
      label: "CPL",
      value: formatCurrency(kpis.avgCpl),
      icon: ArrowDownRight,
    },
    {
      label: "Conversão",
      value: `${kpis.avgConversionRate.toFixed(1)}%`,
      icon: Percent,
    },
    {
      label: "ROAS",
      value: kpis.roas.toFixed(2) + "x",
      icon: TrendingUp,
    },
    {
      label: "CAC",
      value: formatCurrency(kpis.cac),
      icon: Target,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <card.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            <p className="text-lg font-semibold tabular-nums">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write UtmDataTable**

```tsx
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpDown, ChevronRight } from "lucide-react";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import type { UtmCombinedRow, UtmLevel } from "@/hooks/useAnalyticsUtms";

interface Props {
  data: UtmCombinedRow[];
  level: UtmLevel;
  onDrillDown: (name: string, metaId: string | null) => void;
}

type SortKey = keyof Pick<
  UtmCombinedRow,
  "name" | "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "totalLeads" | "conversionRate" | "cpl" | "cac"
>;

const LEVEL_TITLES: Record<string, string> = {
  campaign: "Campanhas",
  adset: "Conjuntos de Anúncios",
  ad: "Anúncios",
};

function formatCurrency(value: number): string {
  if (value === 0) return "-";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function cplColor(value: number): string {
  if (value === 0) return "";
  if (value <= 15) return "text-emerald-500";
  if (value <= 40) return "text-yellow-500";
  return "text-red-500";
}

function cacColor(value: number): string {
  if (value === 0) return "";
  if (value <= 100) return "text-emerald-500";
  if (value <= 300) return "text-yellow-500";
  return "text-red-500";
}

export function UtmDataTable({ data, level, onDrillDown }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    if (typeof av === "string" && typeof bv === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{LEVEL_TITLES[level] || level}</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Sem dados de UTM no período."
            detail="Verifique se os leads do Meta Ads possuem UTMs preenchidas."
          />
        </CardContent>
      </Card>
    );
  }

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "name", label: "Nome" },
    { key: "spend", label: "Investimento", align: "right" },
    { key: "impressions", label: "Impressoes", align: "right" },
    { key: "clicks", label: "Cliques", align: "right" },
    { key: "ctr", label: "CTR", align: "right" },
    { key: "cpc", label: "CPC", align: "right" },
    { key: "totalLeads", label: "Leads", align: "right" },
    { key: "conversionRate", label: "Conversão", align: "right" },
    { key: "cpl", label: "CPL", align: "right" },
    { key: "cac", label: "CAC", align: "right" },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{LEVEL_TITLES[level] || level}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`font-medium text-muted-foreground py-2 px-2 cursor-pointer hover:text-foreground transition-colors ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                ))}
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.id || row.name}
                  className="border-b border-border/40 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => onDrillDown(row.name, row.meta_id)}
                >
                  <td className="py-2 px-2 font-medium max-w-[200px] truncate">{row.name || "-"}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(row.spend)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatNumber(row.impressions)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatNumber(row.clicks)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{row.ctr.toFixed(2)}%</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(row.cpc)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-medium">{row.totalLeads}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{row.conversionRate.toFixed(1)}%</td>
                  <td className={`py-2 px-2 text-right tabular-nums ${cplColor(row.cpl)}`}>
                    {formatCurrency(row.cpl)}
                  </td>
                  <td className={`py-2 px-2 text-right tabular-nums ${cacColor(row.cac)}`}>
                    {formatCurrency(row.cac)}
                  </td>
                  <td className="py-1 px-1">
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write UtmLeadsList**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, ExternalLink } from "lucide-react";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";
import type { UtmLeadRow } from "@/hooks/useAnalyticsUtms";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  leads: UtmLeadRow[];
  onOpenLead: (leadId: string) => void;
}

export function UtmLeadsList({ leads, onOpenLead }: Props) {
  if (leads.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Leads</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Nenhum lead encontrado."
            detail="Não há leads com esta combinação de UTMs no período."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Leads ({leads.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Nome</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Email</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Telefone</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Entrada</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Status</th>
                <th className="text-left font-medium text-muted-foreground py-2 px-2">Responsável</th>
                <th className="text-center font-medium text-muted-foreground py-2 px-2">Rating</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-border/40 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-2 px-2">
                    <button
                      onClick={() => onOpenLead(lead.id)}
                      className="font-medium text-primary hover:underline underline-offset-2 inline-flex items-center gap-1"
                    >
                      {lead.name}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{lead.email || "-"}</td>
                  <td className="py-2 px-2 text-muted-foreground">{lead.phone || "-"}</td>
                  <td className="py-2 px-2 text-muted-foreground tabular-nums">
                    {format(new Date(lead.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                  </td>
                  <td className="py-2 px-2">
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                      {lead.pipe_status}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{lead.responsible}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3 w-3 ${
                            i < lead.rating
                              ? "fill-yellow-400 text-yellow-400"
                              : "text-muted-foreground/30"
                          }`}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/analytics/charts/UtmBreadcrumb.tsx \
        src/components/analytics/charts/UtmKpiCards.tsx \
        src/components/analytics/charts/UtmDataTable.tsx \
        src/components/analytics/charts/UtmLeadsList.tsx
git commit -m "feat(analytics): add UTM UI components (breadcrumb, KPIs, table, leads list)"
```

---

## Task 7: UtmsTab Container + Wire Into Analytics Page

**Files:**
- Create: `src/components/analytics/tabs/UtmsTab.tsx`
- Modify: `src/pages/Analytics.tsx`

- [ ] **Step 1: Write UtmsTab**

```tsx
import { useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useAnalyticsUtms, type UtmLevel } from "@/hooks/useAnalyticsUtms";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { UtmBreadcrumb } from "../charts/UtmBreadcrumb";
import { UtmKpiCards } from "../charts/UtmKpiCards";
import { UtmDataTable } from "../charts/UtmDataTable";
import { UtmLeadsList } from "../charts/UtmLeadsList";
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer";

interface DrillDownState {
  level: UtmLevel;
  campaign: string | null;
  campaignMetaId: string | null;
  adset: string | null;
  adsetMetaId: string | null;
  ad: string | null;
}

export function UtmsTab() {
  const [drill, setDrill] = useState<DrillDownState>({
    level: "campaign",
    campaign: null,
    campaignMetaId: null,
    adset: null,
    adsetMetaId: null,
    ad: null,
  });

  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const { data, isLoading } = useAnalyticsUtms(
    drill.level,
    drill.campaign,
    drill.adset,
    drill.ad,
    drill.campaignMetaId,
    drill.adsetMetaId,
  );

  const handleDrillDown = useCallback((name: string, metaId: string | null) => {
    if (drill.level === "campaign") {
      setDrill({
        level: "adset",
        campaign: name,
        campaignMetaId: metaId,
        adset: null,
        adsetMetaId: null,
        ad: null,
      });
    } else if (drill.level === "adset") {
      setDrill((prev) => ({
        ...prev,
        level: "ad",
        adset: name,
        adsetMetaId: metaId,
      }));
    } else if (drill.level === "ad") {
      setDrill((prev) => ({
        ...prev,
        level: "leads",
        ad: name,
      }));
    }
  }, [drill.level]);

  const handleNavigate = useCallback((level: UtmLevel, campaign?: string | null, adset?: string | null) => {
    if (level === "campaign") {
      setDrill({
        level: "campaign",
        campaign: null,
        campaignMetaId: null,
        adset: null,
        adsetMetaId: null,
        ad: null,
      });
    } else if (level === "adset") {
      setDrill((prev) => ({
        ...prev,
        level: "adset",
        adset: null,
        adsetMetaId: null,
        ad: null,
      }));
    } else if (level === "ad") {
      setDrill((prev) => ({
        ...prev,
        level: "ad",
        ad: null,
      }));
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <UtmBreadcrumb
        level={drill.level}
        campaign={drill.campaign}
        adset={drill.adset}
        ad={drill.ad}
        onNavigate={handleNavigate}
      />

      {/* KPI Cards (not shown on leads level) */}
      {drill.level !== "leads" && (
        <AnalyticsErrorBoundary>
          <UtmKpiCards kpis={data.kpis} />
        </AnalyticsErrorBoundary>
      )}

      {/* Data Table or Leads List */}
      {drill.level === "leads" ? (
        <AnalyticsErrorBoundary>
          <UtmLeadsList
            leads={data.leads}
            onOpenLead={(id) => setSelectedLeadId(id)}
          />
        </AnalyticsErrorBoundary>
      ) : (
        <AnalyticsErrorBoundary>
          <UtmDataTable
            data={data.items}
            level={drill.level}
            onDrillDown={handleDrillDown}
          />
        </AnalyticsErrorBoundary>
      )}

      {/* Lead Detail Drawer */}
      <LeadDetailDrawer
        leadId={selectedLeadId}
        open={!!selectedLeadId}
        onOpenChange={(open) => { if (!open) setSelectedLeadId(null); }}
        variant="leads"
      />
    </div>
  );
}
```

- [ ] **Step 2: Add UTMs tab to Analytics.tsx**

In `src/pages/Analytics.tsx`, add the import and tab.

Add import at the top:

```typescript
import { UtmsTab } from "@/components/analytics/tabs/UtmsTab";
import { useOrganization } from "@/hooks/useOrganization";
```

Inside the component, add the org check:

```typescript
const { organizationId } = useOrganization();
const MILENNIALS_ORG_ID = import.meta.env.VITE_MILENNIALS_ORG_ID || "";
const showUtmsTab = organizationId === MILENNIALS_ORG_ID;
```

Add TabsTrigger after the "engajamento" trigger:

```tsx
{showUtmsTab && (
  <TabsTrigger value="utms">UTMs</TabsTrigger>
)}
```

Add TabsContent after the "engajamento" content:

```tsx
{showUtmsTab && (
  <TabsContent value="utms" className="space-y-4">
    <UtmsTab />
  </TabsContent>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/tabs/UtmsTab.tsx src/pages/Analytics.tsx
git commit -m "feat(analytics): add UTMs tab with drill-down navigation"
```

---

## Task 8: Environment Variables

**Files:**
- Modify: `.env` or `.env.example` (add entries)

- [ ] **Step 1: Document the required env vars**

Add to `.env.example` or `.env.local`:

```
# Meta Ads Insights (UTMs Analytics)
META_ADS_ACCESS_TOKEN=EAAxxxxxxx
META_ADS_ACCOUNT_ID=act_1234567890
MILENNIALS_ORG_ID=<uuid-da-org-milennials>

# Frontend (Vite)
VITE_MILENNIALS_ORG_ID=<uuid-da-org-milennials>
```

The `META_ADS_ACCESS_TOKEN` and `META_ADS_ACCOUNT_ID` go in the Supabase Edge Function environment (via Supabase dashboard or `supabase secrets set`).

The `MILENNIALS_ORG_ID` goes in both Supabase Edge Functions env AND the Vite frontend `.env`.

- [ ] **Step 2: Commit**

```bash
git add -N .env.example 2>/dev/null; git add .env.example 2>/dev/null
git commit -m "docs: add UTM analytics env vars to .env.example" --allow-empty
```

---

## Task 9: Integration Verification

- [ ] **Step 1: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Fix any type errors found.

- [ ] **Step 2: Verify dev server starts**

Run: `npm run dev` (check it starts without errors, then Ctrl+C)

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(analytics): resolve build issues in UTMs tab"
```


## Links relacionados

- [[Analytics Comercial]]
- [[Analytics UTMs]]

- [[Visao Geral]]

- [[Gestao de Time]]

- [[Webhooks]]

- [[Dashboard]]

- [[Campanhas]]

- [[Meta Facebook]]

- [[Pipe Propostas]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
