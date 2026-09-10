import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { AuthError, authErrorResponse, requireAuth } from "../_shared/user-auth.ts";
import { assertPlanFeature, PlanFeatureDeniedError, planDeniedResponse } from "../_shared/plan-gate.ts";
import { handleAdminBriefing } from "../_shared/oraculo/briefing-handler.ts";
import { createAdminBriefingStore } from "../_shared/oraculo/briefing-store.ts";

Deno.serve(withErrorBoundary("oraculo-briefing", async (req) => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const store = createAdminBriefingStore(db);
  try {
    return await handleAdminBriefing(req, {
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
      current: store.current,
      open: store.open,
    }, cors);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error, cors);
    if (error instanceof PlanFeatureDeniedError) return planDeniedResponse(error, cors);
    throw error;
  }
}));
