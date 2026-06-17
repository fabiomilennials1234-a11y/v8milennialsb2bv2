/**
 * meta-template-create — validates input, persists a template row (status
 * 'pending'), then submits it to Meta's Graph API (POST
 * /{waba_id}/message_templates) and records the returned meta_template_id
 * (Slice 6, ADR-0009).
 *
 * Auth: JWT via requireAuth (config.toml verify_jwt=false → custom auth).
 * Org comes from the auth context, never the body. Only the WABA token resolved
 * via the service_role RPC get_meta_cloud_credentials touches Meta — it is never
 * persisted on the template row nor logged.
 *
 * INERT until the `meta_cloud` feature flag is enabled: with no Meta Cloud
 * instance / credentials, submission short-circuits and the row stays 'pending'.
 *
 * Idempotency-ish: the (organization_id, name, language) UNIQUE constraint makes
 * a duplicate create return 409 rather than spawning a second Meta submission.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withSentry } from "../_shared/sentry.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import {
  validateCreateInput,
  buildCreatePayload,
  createMetaTemplateGraph,
} from "../_shared/meta-templates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withSentry("meta-template-create", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers });
  }

  let auth;
  try {
    auth = await requireAuth(req, { body });
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }

  const orgId = auth.organizationId || (auth.isMaster ? (body.organization_id as string) : "");
  if (!orgId) {
    return new Response(JSON.stringify({ error: "organization_id_required" }), { status: 400, headers });
  }

  // ── Validate input (pure) ──────────────────────────────────────────────────
  const validation = validateCreateInput({
    name: body.name as string,
    language: body.language as string,
    category: body.category as string,
    components: body.components,
  });
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.error }), { status: 400, headers });
  }
  const template = validation.value;
  const instanceId = typeof body.instance_id === "string" ? body.instance_id : null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // If an instance is supplied, verify it belongs to this org (no cross-tenant
  // binding). Master is allowed to operate on the requested org's instance.
  if (instanceId) {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("id, organization_id")
      .eq("id", instanceId)
      .maybeSingle();
    if (!inst || inst.organization_id !== orgId) {
      return new Response(JSON.stringify({ error: "instance_not_in_org" }), { status: 403, headers });
    }
  }

  // ── Persist the pending row first (source of truth) ─────────────────────────
  const { data: row, error: insertErr } = await supabase
    .from("meta_message_templates")
    .insert({
      organization_id: orgId,
      instance_id: instanceId,
      name: template.name,
      language: template.language,
      category: template.category,
      components: template.components,
      status: "pending",
    })
    .select()
    .single();

  if (insertErr) {
    // 23505 = unique_violation (organization_id, name, language) already exists.
    const status = insertErr.code === "23505" ? 409 : 500;
    return new Response(JSON.stringify({ error: insertErr.message, code: insertErr.code }), {
      status,
      headers,
    });
  }

  // ── Submit to Meta (only when this instance has Meta Cloud credentials) ─────
  // Resolved via the service_role RPC — never the secrets table directly.
  if (instanceId) {
    const { data: creds } = await supabase.rpc("get_meta_cloud_credentials", {
      p_instance_id: instanceId,
    });
    const cred = Array.isArray(creds) ? creds[0] : creds;
    if (cred?.meta_waba_id && cred?.meta_access_token) {
      try {
        const graph = createMetaTemplateGraph({ token: cred.meta_access_token });
        const created = await graph.createTemplate(cred.meta_waba_id, buildCreatePayload(template));
        await supabase
          .from("meta_message_templates")
          .update({ meta_template_id: created.id, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        row.meta_template_id = created.id;
      } catch (e) {
        // Submission failed — the row stays pending with no meta_template_id; the
        // client can retry. Never echo the token; only the Graph message.
        return new Response(
          JSON.stringify({
            template: row,
            submitted: false,
            error: (e as Error).message,
          }),
          { status: 502, headers },
        );
      }
    }
  }

  return new Response(
    JSON.stringify({ template: row, submitted: Boolean(row.meta_template_id) }),
    { status: 201, headers },
  );
}));
