/**
 * meta-asset-admin — master-only enumeration + binding of Meta assets
 * (ADR-0009, slice 3). Powers the org-centric binding tab.
 *
 * Auth: JWT (supabase.functions.invoke sends it). The caller MUST be an active
 * master (master_users). Reads the Torque Meta token from meta_app_config and
 * enumerates Pages (business owned + client pages) + Ad Accounts, joined with
 * current bindings, plus the org list to assign to.
 *
 * GET    → { assets: [{type,id,name,instagram?,boundOrgId?,datasetId?,...}], orgs:[{id,name}] }
 * POST   { asset_type, asset_id, asset_name, organization_id, dataset_id? } → bind (409 if asset already bound elsewhere)
 * PATCH  { asset_id, dataset_id }                                          → set dataset id
 * DELETE { asset_id }                                                      → unbind
 */

import { withSentry } from "../_shared/sentry.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { createMetaGraphClient } from "../_shared/meta/graph-client.ts";

Deno.serve(withSentry("meta-asset-admin", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("Origin") ?? undefined));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Master gate ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(corsHeaders, 401, { error: "Missing token" });
  const { data: userRes, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userRes?.user) return json(corsHeaders, 401, { error: "Invalid token" });
  const { data: master } = await supabase
    .from("master_users").select("id").eq("user_id", userRes.user.id).eq("is_active", true).maybeSingle();
  if (!master) return json(corsHeaders, 403, { error: "Master only" });

  // ── Token ────────────────────────────────────────────────────────────────
  const { data: cfg } = await supabase
    .from("meta_app_config").select("system_user_token, business_id").eq("id", true).single();
  if (!cfg?.system_user_token) return json(corsHeaders, 500, { error: "meta_app_config missing" });
  const graph = createMetaGraphClient({ token: cfg.system_user_token });

  try {
    if (req.method === "GET") {
      const [pages, adAccounts, bindingsRes, orgsRes] = await Promise.all([
        cfg.business_id ? graph.listPages(cfg.business_id) : Promise.resolve([]),
        graph.listAdAccounts(),
        supabase.from("meta_asset_bindings").select("asset_type, asset_id, organization_id, dataset_id, status, last_polled_at, last_error"),
        supabase.from("organizations").select("id, name").order("name"),
      ]);

      const bindByAsset = new Map<string, any>();
      for (const b of bindingsRes.data ?? []) bindByAsset.set(`${b.asset_type}:${b.asset_id}`, b);

      const assets = [
        ...pages.map((p) => buildAsset("page", p.id, p.name, bindByAsset, { instagram: p.instagram_business_account?.id ? true : false })),
        ...adAccounts.map((a) => buildAsset("ad_account", a.id, a.name, bindByAsset, { accountStatus: a.account_status })),
      ];

      return json(corsHeaders, 200, { assets, orgs: orgsRes.data ?? [] });
    }

    const body = await req.json().catch(() => ({}));

    if (req.method === "POST") {
      const { asset_type, asset_id, asset_name, organization_id, dataset_id } = body;
      if (!asset_type || !asset_id || !organization_id) return json(corsHeaders, 400, { error: "asset_type, asset_id, organization_id required" });

      // Enforce one-asset-one-org.
      const { data: clash } = await supabase
        .from("meta_asset_bindings").select("organization_id").eq("asset_type", asset_type).eq("asset_id", asset_id).maybeSingle();
      if (clash && clash.organization_id !== organization_id) {
        return json(corsHeaders, 409, { error: "asset already bound to another org" });
      }

      const { error } = await supabase.from("meta_asset_bindings").upsert({
        asset_type, asset_id, asset_name: asset_name ?? null, organization_id,
        dataset_id: dataset_id ?? null, status: "active",
        // Pages: start the cursor at now so the first poll only ingests new leads.
        last_polled_at: asset_type === "page" ? new Date().toISOString() : null,
      }, { onConflict: "asset_type,asset_id" });
      if (error) return json(corsHeaders, 500, { error: error.message });
      return json(corsHeaders, 200, { ok: true });
    }

    if (req.method === "PATCH") {
      const { asset_id, dataset_id } = body;
      if (!asset_id) return json(corsHeaders, 400, { error: "asset_id required" });
      const { error } = await supabase.from("meta_asset_bindings")
        .update({ dataset_id: dataset_id ?? null, updated_at: new Date().toISOString() })
        .eq("asset_type", "ad_account").eq("asset_id", asset_id);
      if (error) return json(corsHeaders, 500, { error: error.message });
      return json(corsHeaders, 200, { ok: true });
    }

    if (req.method === "DELETE") {
      const { asset_id, asset_type } = body;
      if (!asset_id || !asset_type) return json(corsHeaders, 400, { error: "asset_id, asset_type required" });
      const { error } = await supabase.from("meta_asset_bindings").delete().eq("asset_type", asset_type).eq("asset_id", asset_id);
      if (error) return json(corsHeaders, 500, { error: error.message });
      return json(corsHeaders, 200, { ok: true });
    }

    return json(corsHeaders, 405, { error: "Method not allowed" });
  } catch (e) {
    return json(corsHeaders, 502, { error: `Meta enumeration failed: ${(e as Error).message}` });
  }
}));

function buildAsset(
  type: "page" | "ad_account", id: string, name: string,
  bindByAsset: Map<string, any>, extra: Record<string, unknown>,
) {
  const b = bindByAsset.get(`${type}:${id}`);
  return {
    type, id, name,
    boundOrgId: b?.organization_id ?? null,
    datasetId: b?.dataset_id ?? null,
    status: b?.status ?? null,
    lastPolledAt: b?.last_polled_at ?? null,
    lastError: b?.last_error ?? null,
    ...extra,
  };
}

function json(headers: Record<string, string>, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
