/** Lê e versiona o perfil da operação com organização e autoria vindas do JWT. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import {
  assertPlanFeature,
  planDeniedResponse,
  PlanFeatureDeniedError,
} from "../_shared/plan-gate.ts";
import { AuthError, authErrorResponse, requireAuth } from "../_shared/user-auth.ts";
import { handleProfile } from "../_shared/oraculo/profile-handler.ts";

Deno.serve(withErrorBoundary("oraculo-profile", async (req) => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    return await handleProfile(req, {
      auth: async (request, body) => {
        const ctx = await requireAuth(request, { body, requireOrganization: true });
        await assertPlanFeature(db, ctx.organizationId, "oraculo");
        return {
          userId: ctx.userId,
          teamMemberId: ctx.teamMemberId,
          organizationId: ctx.organizationId,
          role: ctx.role,
          isMaster: ctx.isMaster,
          isAdmin: ctx.isAdmin,
        };
      },
      list: async (actor) => {
        const { data, error } = await db.rpc("oraculo_get_operation_profile", {
          p_organization_id: actor.organizationId,
          p_subject_team_member_id: actor.isAdmin ? null : actor.teamMemberId,
        });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
      },
      respond: async (actor, input) => {
        const { data, error } = await db.rpc("oraculo_record_profile_response", {
          p_organization_id: actor.organizationId,
          p_user_id: actor.userId,
          p_team_member_id: actor.teamMemberId,
          p_question_id: input.questionId,
          p_answer: input.answer,
          p_skip: input.skip,
        });
        if (error) throw error;
        return data;
      },
      saveOwn: async (actor, input) => {
        const { data, error } = await db.rpc("oraculo_edit_own_profile", {
          p_organization_id: actor.organizationId,
          p_user_id: actor.userId,
          p_team_member_id: actor.teamMemberId,
          p_question_key: input.questionKey,
          p_answer: input.answer,
        });
        if (error) throw error;
        return data;
      },
      adjust: async (actor, input) => {
        const { data, error } = await db.rpc("oraculo_adjust_member_profile", {
          p_organization_id: actor.organizationId,
          p_admin_user_id: actor.userId,
          p_subject_team_member_id: input.teamMemberId,
          p_question_key: input.questionKey,
          p_answer: input.answer,
        });
        if (error) throw error;
        return data;
      },
    }, cors);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error, cors);
    if (error instanceof PlanFeatureDeniedError) return planDeniedResponse(error, cors);
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "42501") {
      return new Response(JSON.stringify({ error: "perfil_indisponivel" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (code === "22023") {
      return new Response(JSON.stringify({ error: "resposta_invalida" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    throw error;
  }
}));
