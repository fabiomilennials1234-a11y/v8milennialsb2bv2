/**
 * Create Gestor — Edge Function (Master only) — ADR-0021 §8.
 *
 * Provisiona um Gestor de Portfólio ("scoped master"): ator FORA de `team_members`
 * com escrita full de admin operacional nas orgs vinculadas pelo Master.
 *
 * Fluxo:
 *  1. Master-gate: valida X-User-JWT → getUser → master_users ativo (fail-closed).
 *  2. Resolve o auth user: reaproveita conta existente (match por email) OU cria
 *     uma nova (reuse do padrão de create-org-user; exige senha ≥ 6).
 *  3. Insere/reativa a linha em `gestores`.
 *  4. Opcional: vincula orgs iniciais em `gestor_organizations`.
 *
 * Um usuário pode ser Gestor E team_member/admin em outra org — os helpers de RLS
 * apenas unem os conjuntos (ADR-0021 §8), nenhum tratamento especial aqui.
 *
 * Auth de plataforma: verify_jwt padrão (true) — o frontend envia o anon key em
 * Authorization: Bearer e o JWT real do usuário em X-User-JWT (mesma convenção de
 * create-org-user / list-unassigned-users). Não requer entrada em config.toml.
 */

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
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

interface CreateGestorBody {
  email: string;
  name?: string;
  password?: string;
  notes?: string;
  organization_ids?: string[];
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

/** Procura um auth user por email (case-insensitive), paginando admin.listUsers. */
async function findUserIdByEmail(supabase: SupabaseClient, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 1000;
  // Limite de segurança para não paginar indefinidamente.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const match = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) return match.id;
    if (users.length < perPage) break;
    page++;
  }
  return null;
}

serve(withErrorBoundary("create-gestor", async (req) => {
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
    let body: CreateGestorBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Bad request", message: "Invalid JSON body" }, 400, corsHeaders);
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const orgIds = Array.isArray(body.organization_ids)
      ? body.organization_ids.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ success: false, error: "Bad request", message: "Email inválido" }, 400, corsHeaders);
    }

    // ----- Resolve o auth user (reaproveita existente OU cria) -----
    let userId = await findUserIdByEmail(supabase, email);
    if (!userId) {
      if (!password || password.length < 6) {
        return jsonResponse(
          { success: false, error: "Bad request", message: "Conta não existe: informe uma senha (mín. 6 caracteres) para criá-la" },
          400,
          corsHeaders,
        );
      }
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name || email.split("@")[0] },
      });
      if (createError || !created?.user?.id) {
        const msg = createError?.message?.toLowerCase() ?? "";
        if (msg.includes("already") || msg.includes("registered")) {
          // Corrida rara: criado entre o lookup e o create. Reaproveita.
          userId = await findUserIdByEmail(supabase, email);
        }
        if (!userId) {
          return jsonResponse({ success: false, error: "Create failed", message: createError?.message ?? "Falha ao criar usuário" }, 400, corsHeaders);
        }
      } else {
        userId = created.user.id;
      }
      await supabase.from("profiles").upsert(
        { id: userId, full_name: name || email.split("@")[0] },
        { onConflict: "id" },
      );
    } else if (name) {
      // Conta existente — atualiza o nome do perfil se informado (sem sobrescrever com vazio).
      await supabase.from("profiles").upsert({ id: userId, full_name: name }, { onConflict: "id" });
    }

    // ----- Insere/reativa a linha em `gestores` -----
    const { data: existingGestor } = await supabase
      .from("gestores")
      .select("id, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    let gestorId: string;
    if (existingGestor?.id) {
      gestorId = existingGestor.id as string;
      const { error: updErr } = await supabase
        .from("gestores")
        .update({ is_active: true, ...(notes ? { notes } : {}) })
        .eq("id", gestorId);
      if (updErr) {
        return jsonResponse({ success: false, error: "Update failed", message: updErr.message }, 500, corsHeaders);
      }
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("gestores")
        .insert({ user_id: userId, is_active: true, notes: notes || null })
        .select("id")
        .single();
      if (insErr || !inserted?.id) {
        return jsonResponse({ success: false, error: "Insert failed", message: insErr?.message ?? "Falha ao criar gestor" }, 500, corsHeaders);
      }
      gestorId = inserted.id as string;
    }

    // ----- Vínculos iniciais (opcional) -----
    if (orgIds.length > 0) {
      const { data: currentBindings } = await supabase
        .from("gestor_organizations")
        .select("organization_id")
        .eq("gestor_id", gestorId);
      const already = new Set((currentBindings ?? []).map((b) => b.organization_id as string));
      const toAdd = orgIds.filter((o) => !already.has(o));
      if (toAdd.length > 0) {
        const { error: bindErr } = await supabase
          .from("gestor_organizations")
          .insert(toAdd.map((organization_id) => ({ gestor_id: gestorId, organization_id })));
        if (bindErr) {
          return jsonResponse({ success: false, error: "Bind failed", message: bindErr.message }, 500, corsHeaders);
        }
      }
    }

    await logRuntime({
      module: "permission",
      action: "create_gestor",
      status: "success",
      entityType: "gestor",
      entityId: gestorId,
      triggeredBy: user.id,
      payloadSnapshot: { user_id: userId, org_count: orgIds.length },
    });

    return jsonResponse({ success: true, gestor_id: gestorId, user_id: userId }, 200, corsHeaders);
  } catch (err) {
    console.error("[create-gestor]", err);
    await logRuntime({
      module: "permission",
      action: "create_gestor",
      status: "error",
      errorMessage: String(err),
    });
    return jsonResponse({ success: false, error: "Internal server error", message: String(err) }, 500, corsHeaders);
  }
}));
