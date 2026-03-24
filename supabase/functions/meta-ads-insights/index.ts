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
