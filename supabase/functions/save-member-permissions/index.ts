import { requireAdmin, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";

Deno.serve(withErrorBoundary("save-member-permissions", async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const auth = await requireAdmin(req, { body });

    const { teamMemberId, permissions } = body as {
      teamMemberId: string;
      permissions: Record<string, boolean>;
    };

    if (!teamMemberId || !permissions || typeof permissions !== "object") {
      return new Response(
        JSON.stringify({ error: "teamMemberId e permissions são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Verificar se team member pertence à mesma org
    const { data: targetMember } = await supabase
      .from("team_members")
      .select("id, organization_id")
      .eq("id", teamMemberId)
      .eq("organization_id", auth.organizationId)
      .maybeSingle();

    if (!targetMember) {
      return new Response(
        JSON.stringify({ error: "Membro não encontrado na sua organização" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Deletar permissões existentes do membro
    await supabase
      .from("member_feature_permissions")
      .delete()
      .eq("team_member_id", teamMemberId);

    // Inserir novas permissões (apenas as que diferem do default)
    const rows = Object.entries(permissions).map(([featureKey, enabled]) => ({
      team_member_id: teamMemberId,
      organization_id: auth.organizationId,
      feature_key: featureKey,
      enabled,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error: insErr } = await supabase
        .from("member_feature_permissions")
        .insert(rows);
      if (insErr) throw insErr;
    }

    return new Response(
      JSON.stringify({ success: true, count: rows.length }),
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
}));
