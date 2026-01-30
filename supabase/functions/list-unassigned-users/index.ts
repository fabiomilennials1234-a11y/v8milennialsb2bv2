/**
 * List Unassigned Users - Edge Function (Master only)
 *
 * Lista usuários que se cadastraram (auth.users) mas não têm organização
 * (não estão em team_members). Apenas Master pode chamar.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

const CORS_PREFLIGHT_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-user-jwt",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface UnassignedUser {
  id: string;
  email: string;
  created_at: string;
  full_name: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: CORS_PREFLIGHT_HEADERS });
  }

  let corsHeaders: Record<string, string>;
  try {
    corsHeaders = getCorsHeaders(req.headers.get("origin"));
  } catch {
    corsHeaders = CORS_PREFLIGHT_HEADERS;
  }

  if (req.method !== "GET") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const userJwt =
      req.headers.get("X-User-JWT")?.trim() ||
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")?.trim() ||
      "";
    if (!userJwt || !SUPABASE_ANON_KEY) {
      return jsonResponse(
        { success: false, error: "Unauthorized", message: "JWT obrigatório" },
        401,
        corsHeaders
      );
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser(userJwt);
    if (userError || !user?.id) {
      return jsonResponse(
        { success: false, error: "Unauthorized", message: "JWT inválido ou expirado" },
        401,
        corsHeaders
      );
    }

    const { data: masterRow } = await supabase
      .from("master_users")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!masterRow?.id) {
      return jsonResponse(
        { success: false, error: "Forbidden", message: "Apenas Master pode listar cadastros pendentes" },
        403,
        corsHeaders
      );
    }

    const { data: assignedRows } = await supabase
      .from("team_members")
      .select("user_id");
    const assignedIds = new Set((assignedRows || []).map((r) => r.user_id));

    const allUsers: UnassignedUser[] = [];
    let page = 1;
    const perPage = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
        page,
        perPage,
      });
      if (listError) {
        console.error("[list-unassigned-users] listUsers error:", listError);
        return jsonResponse(
          { success: false, error: "List failed", message: listError.message },
          500,
          corsHeaders
        );
      }
      const users = listData?.users ?? [];
      for (const u of users) {
        if (!assignedIds.has(u.id)) {
          allUsers.push({
            id: u.id,
            email: u.email ?? "",
            created_at: u.created_at ?? "",
            full_name: (u.user_metadata?.full_name as string) ?? null,
          });
        }
      }
      hasMore = users.length === perPage;
      page++;
    }

    return jsonResponse(
      { success: true, users: allUsers },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error("[list-unassigned-users]", err);
    return jsonResponse(
      { success: false, error: "Internal server error", message: String(err) },
      500,
      { ...CORS_PREFLIGHT_HEADERS, "Content-Type": "application/json" }
    );
  }
});
