import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { verifyMetaState } from "../_shared/meta-oauth-state.ts";
import { metaBusinessConfig, exchangeBusinessCode, inspectBusinessToken, validateBusinessToken } from "../_shared/meta-business.ts";
import { listBusinessAdAccounts } from "../_shared/meta-ad-assets.ts";
import { encryptMetaToken } from "../_shared/meta-token-crypto.ts";
import { getMe, listPages, subscribePageWebhook } from "../_shared/meta-api.ts";

Deno.serve(withErrorBoundary("meta-oauth-callback", async (req) => {
  const appUrl = new URL(Deno.env.get("APP_URL") ?? "https://torquecrm.com.br");
  const redirect = (params: Record<string, string>) => {
    const target = new URL("/configuracoes", appUrl);
    target.search = new URLSearchParams({ tab: "integracoes", ...params }).toString();
    return new Response(null, { status: 302, headers: withSecurityHeaders({ Location: target.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }) });
  };
  if (req.method !== "GET") return new Response(null, { status: 405 });
  try {
    if (Deno.env.get("META_CRM_OAUTH_ENABLED") !== "true") return redirect({ meta: "error", reason: "integracao_indisponivel" });
    const config = metaBusinessConfig();
    const url = new URL(req.url);
    const state = await verifyMetaState(url.searchParams.get("state") ?? "", config.secret);
    if (!state || state.appId !== config.appId || state.configId !== config.configId || typeof state.nonce !== "string" || !["facebook", "instagram"].includes(state.connectionType ?? "")) return redirect({ meta: "error", reason: "state_invalido" });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: consumed, error } = await supabase.rpc("meta_consume_oauth_nonce", { p_nonce: state.nonce, p_user_id: state.userId, p_organization_id: state.orgId, p_app_id: config.appId, p_connection_type: state.connectionType });
    if (error || consumed !== true) return redirect({ meta: "error", reason: "state_invalido" });
    if (url.searchParams.has("error")) return redirect({ meta: "error", reason: "autorizacao_recusada" });
    const code = url.searchParams.get("code");
    if (!code) return redirect({ meta: "error", reason: "codigo_ausente" });
    // A configuration-issued system token is used as issued, never exchanged as a user token.
    const token = await exchangeBusinessCode(code, config);
    const inspection = await inspectBusinessToken(token, config);
    const { subjectId, expiresAt } = validateBusinessToken(inspection, config.appId);
    const me = await getMe(token, config.appId);
    if (me.id !== subjectId) throw new Error("meta_subject_mismatch");
    const granted = new Set(inspection.scopes ?? []);
    const pages = (granted.has("pages_show_list") ? await listPages(token, config.appId, subjectId) : []).filter((page) => state.connectionType !== "instagram" || page.instagram_business_account?.id);
    const adAccounts = granted.has("ads_read") || granted.has("ads_management") ? await listBusinessAdAccounts(token, config.appId, subjectId) : [];
    if (state.connectionType === "instagram" && !pages.length) return redirect({ meta: "error", reason: "nenhuma_pagina_autorizada" });
    if (!pages.length && !adAccounts.length) return redirect({ meta: "error", reason: "nenhuma_pagina_autorizada" });
    for (const page of pages) {
      if (!await subscribePageWebhook(page.id, page.access_token, config.appId)) throw new Error("meta_subscription_failed");
    }
    const encryptedToken = await encryptMetaToken(token, { appId: config.appId, organizationId: state.orgId, asset: `connection:${subjectId}` });
    const encryptedPages = await Promise.all(pages.map(async (page) => ({ id: page.id, name: page.name, access_token: await encryptMetaToken(page.access_token, { appId: config.appId, organizationId: state.orgId, asset: `page:${page.id}` }), instagram_account_id: page.instagram_business_account?.id ?? null, instagram_username: page.instagram_username ?? null })));
    // One transaction: rechecks current admin authority, saves tokens, deactivates removed assets.
    const { error: saveError } = await supabase.rpc("meta_save_business_connection", {
      p_user_id: state.userId, p_org_id: state.orgId, p_app_id: config.appId, p_subject: subjectId, p_name: me.name,
      p_type: state.connectionType, p_token: encryptedToken, p_expires: expiresAt,
      p_ad_accounts: adAccounts,
      p_pages: encryptedPages,
    });
    if (saveError) throw new Error("meta_connection_save_failed");
    return redirect({ meta: "connected", connectionType: state.connectionType!, pages: String(pages.length), instagram: String(pages.filter((page) => page.instagram_business_account?.id).length) });
  } catch {
    // Neither Graph errors nor SDK diagnostics may contain tokens in runtime logs or redirects.
    return redirect({ meta: "error", reason: "erro_na_integracao" });
  }
}));
