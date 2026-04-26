import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-jwt",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    // organization_id é obrigatório: sem ele, o fallback "primeiro
    // team_member ativo" avalia permissões contra a org errada para
    // usuários multi-org (incidente 2026-04-23 funis bloqueados).
    const auth = await requireAuth(req, { body, requireOrganization: true });

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Buscar todas as features definidas
    const { data: features, error: featErr } = await supabase
      .from("feature_permissions")
      .select("key, is_admin_only, default_value")
      .order("module")
      .order("sort_order");

    if (featErr) throw featErr;

    // Buscar overrides do membro. Master sem team_member real na org (shadow
    // user no switcher) tem teamMemberId="" — skip a query pra evitar
    // PostgreSQL 22P02 "invalid input syntax for type uuid: ''".
    // Incidente 2026-04-24: master trocando pra org sem TM quebrava edge
    // function e travava loader no SubscriptionProtectedRoute.
    const isValidTeamMemberId =
      typeof auth.teamMemberId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auth.teamMemberId);

    let overrideMap = new Map<string, boolean>();
    if (isValidTeamMemberId) {
      const { data: overrides, error: ovErr } = await supabase
        .from("member_feature_permissions")
        .select("feature_key, enabled")
        .eq("team_member_id", auth.teamMemberId);

      if (ovErr) throw ovErr;

      overrideMap = new Map(
        (overrides || []).map((o: { feature_key: string; enabled: boolean }) => [o.feature_key, o.enabled]),
      );
    }

    // Montar resultado
    const result: Record<string, boolean> = {};
    for (const feat of features || []) {
      if (auth.isAdmin || auth.isMaster) {
        result[feat.key] = true;
      } else if (feat.is_admin_only) {
        result[feat.key] = false;
      } else if (overrideMap.has(feat.key)) {
        result[feat.key] = overrideMap.get(feat.key)!;
      } else {
        result[feat.key] = feat.default_value;
      }
    }

    return new Response(
      JSON.stringify({
        features: result,
        isAdmin: auth.isAdmin,
        jobTitle: auth.jobTitle,
        metricType: auth.metricType,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      // Telemetria Fase 3: AuthError de requireOrganization é sinal da
      // regressão de permissões (incidente 2026-04-24). Log estruturado
      // pra Sentry/log aggregator filtrar. 400 aqui = frontend chamou sem
      // org_id ou org_id inválida para o user.
      console.error(
        JSON.stringify({
          event: "get-member-permissions.auth_error",
          status: error.status,
          message: error.message,
          url: req.url,
        }),
      );
      return authErrorResponse(error, corsHeaders);
    }
    console.error(
      JSON.stringify({
        event: "get-member-permissions.unhandled",
        message: (error as Error).message,
      }),
    );
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
