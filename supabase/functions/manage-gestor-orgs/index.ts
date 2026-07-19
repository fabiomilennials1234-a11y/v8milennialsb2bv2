/**
 * Manage Gestor Orgs — Edge Function (Master only) — ADR-0021 §8.
 *
 * Reconcilia o whitelist de organizações de um Gestor de Portfólio: recebe o
 * conjunto DESEJADO completo (`organization_ids`) e aplica o diff — vincula as
 * novas, desvincula as removidas em `gestor_organizations`. Idempotente.
 *
 * Desvincular revoga o acesso imediatamente: os helpers de RLS
 * (`get_my_organization_ids` / `get_my_admin_organization_ids`, ADR-0021 §2)
 * recomputam a união por chamada; nenhuma sessão precisa ser derrubada.
 *
 * Master-gate idêntico a create-gestor (valida X-User-JWT → master_users ativo).
 * Auth de plataforma: verify_jwt padrão — anon key em Authorization + JWT real em
 * X-User-JWT. Não requer entrada em config.toml.
 */

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

interface ManageGestorOrgsBody {
  gestor_id: string;
  organization_ids: string[];
}

function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(withErrorBoundary("manage-gestor-orgs", async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ----- Master-gate -----
    const userJwt =
      req.headers.get("X-User-JWT")?.trim() ||
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")?.trim() ||
      "";
    if (!userJwt || !SUPABASE_ANON_KEY) {
      return jsonResponse({ success: false, error: "Unauthorized", message: "JWT obrigatório" }, 401, corsHeaders);
    }
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: { user }, error: userError } = await anonClient.auth.getUser(userJwt);
    if (userError || !user?.id) {
      return jsonResponse({ success: false, error: "Unauthorized", message: "JWT inválido ou expirado" }, 401, corsHeaders);
    }
    const { data: masterRow } = await supabase
      .from("master_users")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!masterRow?.id) {
      return jsonResponse({ success: false, error: "Forbidden", message: "Apenas Master pode gerenciar gestores" }, 403, corsHeaders);
    }

    // ----- Body -----
    let body: ManageGestorOrgsBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Bad request", message: "Invalid JSON body" }, 400, corsHeaders);
    }
    const gestorId = typeof body.gestor_id === "string" ? body.gestor_id.trim() : "";
    const desired = Array.isArray(body.organization_ids)
      ? Array.from(
          new Set(body.organization_ids.filter((v): v is string => typeof v === "string" && v.length > 0)),
        )
      : [];
    if (!gestorId) {
      return jsonResponse({ success: false, error: "Bad request", message: "gestor_id é obrigatório" }, 400, corsHeaders);
    }

    // Valida que o gestor existe (evita bindings órfãos).
    const { data: gestor } = await supabase
      .from("gestores")
      .select("id")
      .eq("id", gestorId)
      .maybeSingle();
    if (!gestor?.id) {
      return jsonResponse({ success: false, error: "Not found", message: "Gestor não encontrado" }, 404, corsHeaders);
    }

    // ----- Reconcilia o diff -----
    const { data: currentRows, error: curErr } = await supabase
      .from("gestor_organizations")
      .select("organization_id")
      .eq("gestor_id", gestorId);
    if (curErr) {
      return jsonResponse({ success: false, error: "Read failed", message: curErr.message }, 500, corsHeaders);
    }
    const current = new Set((currentRows ?? []).map((r) => r.organization_id as string));
    const desiredSet = new Set(desired);

    const toAdd = desired.filter((o) => !current.has(o));
    const toRemove = [...current].filter((o) => !desiredSet.has(o));

    if (toRemove.length > 0) {
      const { error: delErr } = await supabase
        .from("gestor_organizations")
        .delete()
        .eq("gestor_id", gestorId)
        .in("organization_id", toRemove);
      if (delErr) {
        return jsonResponse({ success: false, error: "Unbind failed", message: delErr.message }, 500, corsHeaders);
      }
    }
    if (toAdd.length > 0) {
      const { error: insErr } = await supabase
        .from("gestor_organizations")
        .insert(toAdd.map((organization_id) => ({ gestor_id: gestorId, organization_id })));
      if (insErr) {
        return jsonResponse({ success: false, error: "Bind failed", message: insErr.message }, 500, corsHeaders);
      }
    }

    await logRuntime({
      module: "permission",
      action: "manage_gestor_orgs",
      status: "success",
      entityType: "gestor",
      entityId: gestorId,
      triggeredBy: user.id,
      payloadSnapshot: { added: toAdd.length, removed: toRemove.length, total: desired.length },
    });

    return jsonResponse({ success: true, bound: desired, added: toAdd.length, removed: toRemove.length }, 200, corsHeaders);
  } catch (err) {
    console.error("[manage-gestor-orgs]", err);
    await logRuntime({
      module: "permission",
      action: "manage_gestor_orgs",
      status: "error",
      errorMessage: String(err),
    });
    return jsonResponse({ success: false, error: "Internal server error", message: String(err) }, 500, corsHeaders);
  }
}));
