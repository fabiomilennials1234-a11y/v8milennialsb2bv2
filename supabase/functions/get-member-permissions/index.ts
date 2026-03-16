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
    const auth = await requireAuth(req, { body });

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

    // Buscar overrides do membro
    const { data: overrides, error: ovErr } = await supabase
      .from("member_feature_permissions")
      .select("feature_key, enabled")
      .eq("team_member_id", auth.teamMemberId);

    if (ovErr) throw ovErr;

    const overrideMap = new Map(
      (overrides || []).map((o: { feature_key: string; enabled: boolean }) => [o.feature_key, o.enabled]),
    );

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
      return authErrorResponse(error, corsHeaders);
    }
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
