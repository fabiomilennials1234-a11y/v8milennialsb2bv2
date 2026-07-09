/**
 * tinyerp-fetch-nfe
 *
 * Fetches NF-e details (link, number, key, status) from TinyERP
 * and updates tinyerp_order_mappings.
 *
 * Called by:
 *  - tinyerp-webhook (automatically when idNotaFiscal is received)
 *  - Frontend (manual "Buscar NF-e" button)
 *
 * Body: { organizationId, tinyOrderId, idNotaFiscal }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getOrgTinyToken, callTinyApi, logTinyOp, getTinyErrorMessage } from "../_shared/tinyerp-utils.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { timingSafeCompare } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withErrorBoundary("tinyerp-fetch-nfe", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json();
    const { organizationId, tinyOrderId, idNotaFiscal } = body;

    if (!organizationId || !idNotaFiscal) {
      return json({ error: "organizationId and idNotaFiscal are required" }, 400);
    }

    // Auth: accept service_role key (from tinyerp-webhook) or user JWT (frontend)
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const isServiceRole = !!SUPABASE_SERVICE_ROLE_KEY && !!bearerToken &&
      timingSafeCompare(bearerToken, SUPABASE_SERVICE_ROLE_KEY);

    if (!isServiceRole) {
      try {
        const authCtx = await requireAuth(req, {
          body: body as Record<string, unknown>,
          organizationId,
        });
        if (authCtx.organizationId !== organizationId) {
          return json({ error: "Forbidden: org mismatch" }, 403);
        }
      } catch (e) {
        if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
        throw e;
      }
    }

    const tokenData = await getOrgTinyToken(supabaseAdmin, organizationId);
    if (!tokenData) {
      return json({ error: "TinyERP não conectado" });
    }

    console.log("[TinyERP Fetch NF-e] Fetching NF-e:", idNotaFiscal, "for order:", tinyOrderId);

    // 1. Get NF-e details
    const nfeData = await callTinyApi(tokenData.token, "nota.fiscal.obter.php", {
      id: idNotaFiscal,
    });

    const notaFiscal = nfeData.retorno.nota_fiscal as Record<string, unknown> | undefined;

    let nfeNumero: string | null = null;
    let nfeChave: string | null = null;
    let nfeStatus: string | null = null;

    if (notaFiscal) {
      nfeNumero = notaFiscal.numero ? String(notaFiscal.numero) : null;
      nfeChave = notaFiscal.chave_acesso ? String(notaFiscal.chave_acesso) : null;
      nfeStatus = notaFiscal.situacao ? String(notaFiscal.situacao) : null;
    }

    // 2. Get NF-e PDF link
    let nfeLink: string | null = null;
    try {
      const linkData = await callTinyApi(tokenData.token, "nota.fiscal.obter.link.php", {
        id: idNotaFiscal,
      });
      const linkUrl = linkData.retorno.link_externo || linkData.retorno.link;
      if (linkUrl && typeof linkUrl === "string") {
        nfeLink = linkUrl;
      }
    } catch (linkErr) {
      console.warn("[TinyERP Fetch NF-e] Failed to get PDF link (non-blocking):", linkErr);
    }

    console.log("[TinyERP Fetch NF-e] Results:", { nfeNumero, nfeChave, nfeStatus, nfeLink: nfeLink ? "found" : "none" });

    // 3. Update tinyerp_order_mappings
    const updateData: Record<string, unknown> = {
      nfe_updated_at: new Date().toISOString(),
    };
    if (nfeNumero) updateData.nfe_numero = nfeNumero;
    if (nfeChave) updateData.nfe_chave = nfeChave;
    if (nfeStatus) updateData.nfe_status = nfeStatus;
    if (nfeLink) updateData.nfe_link = nfeLink;
    // Also update the legacy columns
    updateData.tiny_nfe_id = String(idNotaFiscal);
    if (nfeStatus) updateData.tiny_nfe_status = nfeStatus;
    updateData.last_synced_at = new Date().toISOString();

    // Find mapping by tinyOrderId or by idNotaFiscal
    let mappingFilter: { column: string; value: string } | null = null;
    if (tinyOrderId) {
      mappingFilter = { column: "tiny_order_id", value: String(tinyOrderId) };
    } else {
      mappingFilter = { column: "tiny_nfe_id", value: String(idNotaFiscal) };
    }

    const { error: updateError } = await supabaseAdmin
      .from("tinyerp_order_mappings")
      .update(updateData)
      .eq(mappingFilter.column, mappingFilter.value);

    if (updateError) {
      console.error("[TinyERP Fetch NF-e] Update error:", updateError);
    }

    // 4. Log
    await logTinyOp(supabaseAdmin, {
      organization_id: organizationId,
      operation: "nfe_fetch",
      status: nfeLink ? "success" : "partial",
      tiny_reference_id: String(idNotaFiscal),
      items_processed: 1,
      items_updated: updateError ? 0 : 1,
      response_payload: { nfeNumero, nfeStatus, hasLink: !!nfeLink },
      initiated_by: "system",
    });

    await logRuntime({
      organizationId,
      module: "general",
      action: "tinyerp_fetch_nfe",
      status: "success",
      entityType: "tinyerp_nfe",
      entityId: String(idNotaFiscal),
      payloadSnapshot: { nfeNumero, nfeStatus, hasLink: !!nfeLink },
    });

    return json({
      success: true,
      nfe_numero: nfeNumero,
      nfe_status: nfeStatus,
      nfe_link: nfeLink,
      nfe_chave: nfeChave,
    });
  } catch (err) {
    console.error("[TinyERP Fetch NF-e] Error:", err);
    await logRuntime({
      module: "general",
      action: "tinyerp_fetch_nfe",
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return json({ error: err instanceof Error ? err.message : "Erro desconhecido" });
  }
}));
