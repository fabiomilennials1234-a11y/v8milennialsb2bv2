/**
 * plan-gate — gating de feature por plano, server-side (fail-closed).
 *
 * Resolve via RPC org_get_features_and_limits(p_org_id) — mesma fonte do
 * frontend (OrgFeaturesContext). Erro na resolução = NEGADO (fail-closed),
 * ao contrário do frontend que é fail-open durante loading.
 */
import { describe, it, expect, vi } from "vitest";
import {
  assertPlanFeature,
  PlanFeatureDeniedError,
} from "../../supabase/functions/_shared/plan-gate";

type RpcResult = { data: unknown; error: { message: string } | null };

function clientWithRpc(result: RpcResult) {
  const rpc = vi.fn(async () => result);
  // Shape mínimo de SupabaseClient que o helper usa
  return { client: { rpc } as never, rpc };
}

function featuresPayload(features: Record<string, boolean>, planName = "torque-1.0") {
  return {
    features,
    limits: { max_users: 5 },
    plan_name: planName,
  };
}

describe("assertPlanFeature", () => {
  it("passa quando feature=true no plano", async () => {
    const { client, rpc } = clientWithRpc({
      data: featuresPayload({ whatsapp_bulk: true }),
      error: null,
    });
    await expect(assertPlanFeature(client, "org-1", "whatsapp_bulk")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("org_get_features_and_limits", { p_org_id: "org-1" });
  });

  it("nega com PlanFeatureDeniedError quando feature=false", async () => {
    const { client } = clientWithRpc({
      data: featuresPayload({ whatsapp_bulk: false }),
      error: null,
    });
    const err = await assertPlanFeature(client, "org-1", "whatsapp_bulk").catch((e) => e);
    expect(err).toBeInstanceOf(PlanFeatureDeniedError);
    expect(err.status).toBe(403);
    expect(err.featureKey).toBe("whatsapp_bulk");
    expect(err.planName).toBe("torque-1.0");
  });

  it("nega quando feature ausente do payload (ausente = não tem)", async () => {
    const { client } = clientWithRpc({ data: featuresPayload({}), error: null });
    await expect(assertPlanFeature(client, "org-1", "copilot")).rejects.toBeInstanceOf(
      PlanFeatureDeniedError
    );
  });

  it("plan_name=master passa mesmo sem a feature", async () => {
    const { client } = clientWithRpc({
      data: featuresPayload({}, "master"),
      error: null,
    });
    await expect(assertPlanFeature(client, "org-1", "copilot")).resolves.toBeUndefined();
  });

  it("erro na RPC → throw genérico (fail-CLOSED), não PlanFeatureDeniedError", async () => {
    const { client } = clientWithRpc({ data: null, error: { message: "boom" } });
    const err = await assertPlanFeature(client, "org-1", "chat").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PlanFeatureDeniedError);
    expect(String(err.message)).toMatch(/plan-gate/);
  });

  it("payload null sem erro → nega (fail-closed)", async () => {
    const { client } = clientWithRpc({ data: null, error: null });
    await expect(assertPlanFeature(client, "org-1", "chat")).rejects.toBeInstanceOf(
      PlanFeatureDeniedError
    );
  });
});
