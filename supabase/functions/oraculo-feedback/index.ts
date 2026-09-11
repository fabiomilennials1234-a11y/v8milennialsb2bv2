/** Feedback autenticado do Oráculo e leitura operacional exclusiva do Master. */

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
import { handleFeedback } from "../_shared/oraculo/feedback-handler.ts";
import { processFeedbackWorker } from "../_shared/oraculo/feedback-worker.ts";
import { createFeedbackWorkerDeps } from "../_shared/oraculo/feedback-worker-store.ts";

Deno.serve(withErrorBoundary("oraculo-feedback", async (req) => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const worker = createFeedbackWorkerDeps(db);

  try {
    return await handleFeedback(req, {
      auth: async (request, body) => {
        const globalMasterAction = body.acao === "listar" || body.acao === "detalhe";
        const ctx = await requireAuth(request, {
          body,
          requireOrganization: !globalMasterAction,
        });
        if (!globalMasterAction) await assertPlanFeature(db, ctx.organizationId, "oraculo");
        let isFullMaster = ctx.isMaster;
        if (globalMasterAction && ctx.isMaster) {
          const { data: master, error } = await db
            .from("master_users")
            .select("permissions")
            .eq("user_id", ctx.userId)
            .eq("is_active", true)
            .maybeSingle();
          if (error) throw error;
          const permissions = master?.permissions as Record<string, unknown> | null;
          isFullMaster = permissions?.all === true;
        }
        return {
          userId: ctx.userId,
          teamMemberId: ctx.teamMemberId,
          organizationId: ctx.organizationId,
          role: ctx.role,
          isMaster: isFullMaster,
          isAdmin: ctx.isAdmin,
        };
      },
      submit: async (actor, input) => {
        const { data, error } = await db.rpc("oraculo_submit_feedback", {
          p_organization_id: actor.organizationId,
          p_user_id: actor.userId,
          p_target_type: input.target,
          p_rating: input.rating,
          p_reason: input.reason,
          p_comment: input.comment,
          p_assistant_turn_id: input.turnId,
          p_conversation_id: input.conversationId,
        });
        if (error) throw error;
        const result = data as { id?: string; alert_id?: string | null } | null;
        if (!result?.id) throw new Error("feedback sem id");
        return { id: result.id, alertId: result.alert_id ?? null };
      },
      notifyNow: async (alertId) => {
        const result = await processFeedbackWorker("alerts", worker, alertId);
        return result.sent === 1;
      },
      state: async (actor, conversationId) => {
        const { data, error } = await db.rpc("oraculo_feedback_state", {
          p_organization_id: actor.organizationId,
          p_user_id: actor.userId,
          p_conversation_id: conversationId,
        });
        if (error) throw error;
        return data ?? { conversation: null, responses: {} };
      },
      signal: async (actor, input) => {
        const { error } = await db.rpc("oraculo_record_product_signal", {
          p_organization_id: actor.organizationId,
          p_user_id: actor.userId,
          p_event_type: input.event,
          p_conversation_id: input.conversationId,
          p_proposal_id: input.proposalId,
        });
        if (error) throw error;
      },
      listCases: async (_actor, limit) => {
        const { data, error } = await db.rpc("oraculo_feedback_cases", { p_limit: limit });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
      },
      getCase: async (_actor, id) => {
        const { data, error } = await db.rpc("oraculo_feedback_case", { p_feedback_id: id });
        if (error) throw error;
        return data ?? null;
      },
    }, cors);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error, cors);
    if (error instanceof PlanFeatureDeniedError) return planDeniedResponse(error, cors);
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "42501") {
      return new Response(JSON.stringify({ error: "alvo_indisponivel" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (code === "22023" || code === "22P02") {
      return new Response(JSON.stringify({ error: "entrada_invalida" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    throw error;
  }
}));
