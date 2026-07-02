/**
 * plan-gate — gating de plano server-side. FAIL-CLOSED: erro na resolução = negado.
 *
 * Fonte única: RPC org_get_features_and_limits(p_org_id) — a mesma que alimenta
 * o OrgFeaturesContext no frontend (plano base + organization_features overrides,
 * que é onde o addon turbo materializa copilot/oraculo + feature_flags defaults).
 *
 * Import estático obrigatório — dynamic import de _shared quebra o bundle eszip
 * em deploy (incidente REALSC 2026-06-12).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export class PlanFeatureDeniedError extends Error {
  readonly status = 403;
  constructor(
    readonly featureKey: string,
    readonly planName: string | null,
  ) {
    super(`Feature '${featureKey}' indisponível no plano '${planName ?? "desconhecido"}'`);
    this.name = "PlanFeatureDeniedError";
  }
}

interface FeaturesPayload {
  features?: Record<string, unknown>;
  plan_name?: string;
}

export async function assertPlanFeature(
  serviceClient: SupabaseClient,
  organizationId: string,
  featureKey: string,
): Promise<void> {
  const { data, error } = await serviceClient.rpc("org_get_features_and_limits", {
    p_org_id: organizationId,
  });
  if (error) {
    throw new Error(`plan-gate: falha ao resolver features da org ${organizationId} (${error.message})`);
  }
  const payload = (data ?? null) as FeaturesPayload | null;
  if (payload?.plan_name === "master") return;
  if (payload?.features?.[featureKey] !== true) {
    throw new PlanFeatureDeniedError(featureKey, payload?.plan_name ?? null);
  }
}

/** Resposta 403 JSON padrão para PlanFeatureDeniedError nos handlers. */
export function planDeniedResponse(
  err: PlanFeatureDeniedError,
  headers: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ error: err.message, feature: err.featureKey, plan: err.planName }),
    { status: 403, headers: { ...headers, "Content-Type": "application/json" } },
  );
}
