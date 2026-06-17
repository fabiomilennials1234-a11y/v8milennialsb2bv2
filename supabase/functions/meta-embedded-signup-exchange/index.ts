/**
 * meta-embedded-signup-exchange — finalizes a WhatsApp Cloud CONNECTION started
 * by the Facebook JS SDK Embedded Signup popup (Slice 3, ADR-0009).
 *
 * FLOW: the frontend launches Embedded Signup, captures the short-lived `code`
 * (response_type:'code') plus the selected WABA/phone via the `message` event
 * (sessionInfo), then POSTs them here. This function:
 *   1. requireAuth → org from the VALIDATED membership (NEVER the body — avoids
 *      the tenant-forgery class; a client cannot bind a number to another org).
 *   2. Exchanges `code` → access token (Graph /oauth/access_token).
 *   3. Resolves + VALIDATES waba_id/phone_number_id against the token's granted
 *      WABAs (debug_token granular_scopes) — a body-supplied WABA must be granted.
 *   4. Registers the number (POST /{phone_number_id}/register) + subscribes the
 *      app to the WABA (POST /{waba_id}/subscribed_apps). Both best-effort with
 *      Meta-side idempotency.
 *   5. UPSERTs a whatsapp_instances row (provider='meta_cloud', status='connected')
 *      idempotent on (organization_id, phone_number_id), then stores the
 *      waba_id/phone_number_id/access_token via the service_role RPC
 *      set_meta_cloud_credentials into the deny-all secrets table.
 *
 * Auth: JWT via requireAuth (config.toml verify_jwt=false → custom auth).
 * Security: org from auth; token persisted ONLY via the RPC (deny-all table),
 * never on a selectable column nor logged; code validated against granted WABAs.
 *
 * INERT until Meta App Review (Tech Provider) + an Embedded Signup config_id
 * exist: with META_APP_ID/META_APP_SECRET unset it returns 503 not_configured,
 * and the frontend never reaches here (graceful fallback toast).
 *
 * Always returns JSON: { instance_id, phone_number_id, status } on success, or
 * { error, code } with a clear machine code on failure.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withSentry } from "../_shared/sentry.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import {
  validateExchangeRequest,
  createMetaEmbeddedSignupGraph,
  resolveWabaAndPhone,
  buildInstanceRow,
  buildSetCredentialsParams,
  EmbeddedSignupError,
} from "../_shared/meta-embedded-signup.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** A deterministic 6-digit PIN for /register. Two-step verification PIN is set
 *  per number; for newly-onboarded Cloud numbers a fresh PIN is accepted. */
const REGISTER_PIN = Deno.env.get("META_CLOUD_REGISTER_PIN") ?? "000000";

Deno.serve(withSentry("meta-embedded-signup-exchange", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed", code: "method_not_allowed" }), {
      status: 405,
      headers,
    });
  }

  // ── Not configured → graceful 503 (INERT state: pre-App-Review) ────────────
  const appId = Deno.env.get("META_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appId || !appSecret) {
    return new Response(
      JSON.stringify({
        error: "WhatsApp Oficial (Meta) ainda não configurado (App Review pendente)",
        code: "not_configured",
      }),
      { status: 503, headers },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body", code: "invalid_body" }), {
      status: 400,
      headers,
    });
  }

  // ── Auth: org comes from the VALIDATED membership, never the body ──────────
  let auth;
  try {
    auth = await requireAuth(req, { body });
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }

  // Org is authoritative from auth. Master without a team_member may target the
  // requested org explicitly; everyone else uses their own membership org.
  const orgId = auth.organizationId || (auth.isMaster ? (body.organization_id as string) : "");
  if (!orgId) {
    return new Response(JSON.stringify({ error: "organization_id_required", code: "organization_id_required" }), {
      status: 400,
      headers,
    });
  }

  // ── Validate input (pure; never trusts body org) ───────────────────────────
  const validation = validateExchangeRequest({
    code: body.code,
    waba_id: body.waba_id,
    phone_number_id: body.phone_number_id,
  });
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.error, code: validation.code }), {
      status: 400,
      headers,
    });
  }
  const { code, wabaId: reqWaba, phoneNumberId: reqPhone } = validation.value;

  const graph = createMetaEmbeddedSignupGraph({ credentials: { appId, appSecret } });

  try {
    // 1. code → access token
    const { accessToken } = await graph.exchangeCode(code);

    // 2. resolve + validate WABA/phone against the token's actual grants
    const { wabaId, phoneNumberId, phone } = await resolveWabaAndPhone(graph, accessToken, {
      wabaId: reqWaba,
      phoneNumberId: reqPhone,
    });

    // 3. register number + subscribe app to WABA (best-effort, Meta-idempotent)
    try {
      await graph.registerNumber(phoneNumberId, accessToken, REGISTER_PIN);
    } catch (e) {
      // A number may already be registered to another app / require a real PIN;
      // do not hard-fail the connection on this — log and continue.
      console.warn("[meta-embedded-signup-exchange] register skipped:", (e as Error).message);
    }
    await graph.subscribeApp(wabaId, accessToken);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 4. UPSERT instance — idempotent on (organization_id, phone_number_id).
    // We resolve the key via the secrets table's meta_phone_number_id (set on a
    // prior run), since whatsapp_instances has no phone_number_id column.
    const row = buildInstanceRow({
      organizationId: orgId,
      phoneNumberId,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name,
    });

    const { data: existing } = await supabase
      .from("whatsapp_instance_secrets")
      .select("instance_id, organization_id")
      .eq("organization_id", orgId)
      .eq("meta_phone_number_id", phoneNumberId)
      .maybeSingle();

    let instanceId: string;
    if (existing?.instance_id) {
      // Re-run for the same number+org → UPDATE, never duplicate.
      instanceId = existing.instance_id;
      const { error: updErr } = await supabase
        .from("whatsapp_instances")
        .update({
          instance_name: row.instance_name,
          phone_number: row.phone_number,
          status: row.status,
          last_connection_at: new Date().toISOString(),
        })
        .eq("id", instanceId)
        .eq("organization_id", orgId);
      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message, code: "instance_update_failed" }), {
          status: 500,
          headers,
        });
      }
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("whatsapp_instances")
        .insert({
          organization_id: row.organization_id,
          provider: row.provider,
          instance_name: row.instance_name,
          phone_number: row.phone_number,
          status: row.status,
          last_connection_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insErr || !inserted?.id) {
        return new Response(JSON.stringify({ error: insErr?.message ?? "insert failed", code: "instance_insert_failed" }), {
          status: 500,
          headers,
        });
      }
      instanceId = inserted.id;
    }

    // 5. Store WABA/phone/token in the deny-all secrets table via service_role RPC.
    const credsParams = buildSetCredentialsParams({
      instanceId,
      organizationId: orgId,
      wabaId,
      phoneNumberId,
      accessToken,
    });
    const { error: credErr } = await supabase.rpc("set_meta_cloud_credentials", credsParams);
    if (credErr) {
      return new Response(JSON.stringify({ error: credErr.message, code: "credentials_store_failed" }), {
        status: 500,
        headers,
      });
    }

    return new Response(
      JSON.stringify({ instance_id: instanceId, phone_number_id: phoneNumberId, status: row.status }),
      { status: 200, headers },
    );
  } catch (e) {
    if (e instanceof EmbeddedSignupError) {
      // Map known Graph/resolution errors to a 502 (upstream) — token never echoed.
      const status = e.code === "no_waba_granted" || e.code === "waba_not_granted" || e.code === "ambiguous_waba" || e.code === "no_phone_number" ? 422 : 502;
      return new Response(JSON.stringify({ error: e.message, code: e.code }), { status, headers });
    }
    return new Response(JSON.stringify({ error: (e as Error).message, code: "unexpected" }), {
      status: 500,
      headers,
    });
  }
}));
