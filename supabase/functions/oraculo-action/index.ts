/** Confirma uma proposta do Oráculo com identidade e permissões do clique. */
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
import {
  ActionExecutionError,
  type ActionExecutionResult,
  handleAction,
} from "../_shared/oraculo/action-handler.ts";

Deno.serve(withErrorBoundary("oraculo-action", async (req) => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    return await handleAction(req, {
      auth: async (request, body) => {
        const ctx = await requireAuth(request, { body, requireOrganization: true });
        await assertPlanFeature(service, ctx.organizationId, "oraculo");
        return {
          userId: ctx.userId,
          teamMemberId: ctx.teamMemberId,
          organizationId: ctx.organizationId,
          role: ctx.role,
          isMaster: ctx.isMaster,
          isAdmin: ctx.isAdmin,
        };
      },
      execute: async (actor, proposalId) => {
        const { data, error } = await asUser.rpc("execute_oraculo_action_proposal", {
          p_proposal_id: proposalId,
          p_organization_id: actor.organizationId,
        });
        if (error) {
          if (error.code === "42501") throw new ActionExecutionError(403, "permissao_recusada");
          throw error;
        }
        if (!data || typeof data !== "object") {
          throw new Error("Resultado inválido ao executar proposta.");
        }
        return data as unknown as ActionExecutionResult;
      },
    }, cors);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error, cors);
    if (error instanceof PlanFeatureDeniedError) return planDeniedResponse(error, cors);
    throw error;
  }
}));
