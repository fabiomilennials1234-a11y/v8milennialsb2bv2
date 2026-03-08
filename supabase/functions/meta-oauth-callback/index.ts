/**
 * meta-oauth-callback
 *
 * Endpoint publico (GET) para onde o Meta redireciona apos o usuario autorizar.
 * Troca o code por tokens, lista paginas/contas Instagram, subscreve webhooks,
 * e redireciona o usuario para /configuracoes?meta=connected.
 *
 * URL: ${SUPABASE_URL}/functions/v1/meta-oauth-callback?code=...&state=...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getMe,
  listPages,
  subscribePageWebhook,
} from "../_shared/meta-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errParam = url.searchParams.get("error");

    const redirect = (params: Record<string, string>) => {
      const p = new URLSearchParams(params);
      return Response.redirect(`${APP_URL}/configuracoes?${p}`, 302);
    };

    // -- Erro retornado pelo Meta -------------------------------------------
    if (errParam) {
      console.error("[meta-oauth-callback] Meta returned error:", errParam);
      return redirect({ meta: "error", reason: errParam });
    }

    if (!code) {
      return redirect({ meta: "error", reason: "codigo_ausente" });
    }

    // -- Decodifica state (userId + orgId) ----------------------------------
    let userId: string | undefined;
    let orgId: string | undefined;

    if (state) {
      try {
        const decoded = JSON.parse(atob(state));
        userId = decoded.userId;
        orgId = decoded.orgId;
      } catch {
        console.warn("[meta-oauth-callback] Could not decode state:", state);
      }
    }

    if (!userId || !orgId) {
      return redirect({ meta: "error", reason: "state_invalido" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // -- Troca code por short-lived token -----------------------------------
    console.log("[meta-oauth-callback] Exchanging code for token...");
    const shortLived = await exchangeCodeForToken(code);

    // -- Troca por long-lived token (~60 dias) ------------------------------
    console.log("[meta-oauth-callback] Exchanging for long-lived token...");
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);

    // Default: 60 dias se nao especificado
    const expiresInSeconds = longLived.expires_in || 60 * 24 * 3600;
    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // -- Busca dados do usuario Meta ----------------------------------------
    console.log("[meta-oauth-callback] Fetching user info...");
    const metaUser = await getMe(longLived.access_token);

    // -- Salva conexao Meta -------------------------------------------------
    const { data: connection, error: connError } = await supabase
      .from("meta_connections")
      .upsert(
        {
          organization_id: orgId,
          user_id: userId,
          facebook_user_id: metaUser.id,
          facebook_user_name: metaUser.name,
          access_token: longLived.access_token,
          token_expires_at: tokenExpiresAt,
          status: "connected",
          connected_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,facebook_user_id" }
      )
      .select("id")
      .single();

    if (connError) {
      console.error("[meta-oauth-callback] Error saving connection:", connError);
      return redirect({ meta: "error", reason: "erro_ao_salvar_conexao" });
    }

    // -- Lista paginas e contas Instagram -----------------------------------
    console.log("[meta-oauth-callback] Listing pages...");
    const pages = await listPages(longLived.access_token);

    let pagesConnected = 0;
    let igAccountsConnected = 0;

    for (const page of pages) {
      // Subscreve webhook
      const subscribed = await subscribePageWebhook(page.id, page.access_token);

      // Salva pagina
      const { error: pageError } = await supabase
        .from("meta_pages")
        .upsert(
          {
            meta_connection_id: connection.id,
            organization_id: orgId,
            page_id: page.id,
            page_name: page.name,
            page_access_token: page.access_token,
            instagram_account_id: page.instagram_business_account?.id || null,
            instagram_username: page.instagram_username || null,
            is_active: true,
            webhook_subscribed: subscribed,
          },
          { onConflict: "organization_id,page_id" }
        );

      if (pageError) {
        console.error(`[meta-oauth-callback] Error saving page ${page.id}:`, pageError);
        continue;
      }

      pagesConnected++;
      if (page.instagram_business_account?.id) {
        igAccountsConnected++;
      }
    }

    console.log(
      `[meta-oauth-callback] Connected: ${pagesConnected} pages, ${igAccountsConnected} IG accounts`
    );

    return redirect({
      meta: "connected",
      pages: String(pagesConnected),
      instagram: String(igAccountsConnected),
    });
  } catch (err) {
    console.error("[meta-oauth-callback] Unexpected error:", err);
    const fallbackUrl = Deno.env.get("APP_URL") ?? "http://localhost:5173";
    return Response.redirect(
      `${fallbackUrl}/configuracoes?meta=error&reason=erro_interno`,
      302
    );
  }
});
