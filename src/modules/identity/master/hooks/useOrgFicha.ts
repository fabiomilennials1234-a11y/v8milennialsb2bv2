/**
 * Organizações — os dados da lista com saúde e da ficha de cada org.
 *
 * Saúde: fatos de `master_org_health_signals` (migration 20271105000200),
 * nota calculada em `lib/org-health.ts`.
 * Features: catálogo + plano + extras, resolvidos em `lib/org-features.ts`.
 * Mudar feature exige motivo (OR-3) e passa pelas RPCs que auditam
 * (`master_enable_feature` / `master_disable_feature`).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMasterAuth } from "./useMasterAuth";
import type { OrgHealthSignals } from "../lib/org-health";
import {
  resolveOrgFeatures,
  type FeatureCatalogEntry,
  type OrgFeatureOverride,
} from "../lib/org-features";

export function useOrgHealthSignals() {
  const { isMaster } = useMasterAuth();
  return useQuery({
    queryKey: ["master-org-health-signals"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("master_org_health_signals");
      if (error) throw error;
      return new Map((data as OrgHealthSignals[]).map((s) => [s.organization_id, s]));
    },
    enabled: isMaster,
    staleTime: 60_000,
  });
}

const FEATURES_KEY = "master-org-features";

export function useOrgFeatures(orgId: string | null) {
  const { isMaster } = useMasterAuth();
  return useQuery({
    queryKey: [FEATURES_KEY, orgId],
    queryFn: async () => {
      const { data: org, error: orgErr } = await supabase
        .from("organizations")
        .select("subscription_plan")
        .eq("id", orgId!)
        .single();
      if (orgErr) throw orgErr;

      const [catalog, overrides, plan] = await Promise.all([
        supabase.from("feature_flags").select("key, name, description, category, default_enabled"),
        supabase
          .from("organization_features")
          .select("feature_key, enabled, override_reason, overridden_at, expires_at")
          .eq("organization_id", orgId!),
        org.subscription_plan
          ? supabase.from("subscription_plans").select("features").eq("name", org.subscription_plan).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (catalog.error) throw catalog.error;
      if (overrides.error) throw overrides.error;
      if (plan.error) throw plan.error;

      return resolveOrgFeatures(
        (catalog.data ?? []) as FeatureCatalogEntry[],
        ((plan.data?.features ?? {}) as Record<string, unknown>) ?? {},
        (overrides.data ?? []) as OrgFeatureOverride[],
      );
    },
    enabled: isMaster && !!orgId,
  });
}

export function useSetOrgFeature() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      orgId: string;
      featureKey: string;
      enable: boolean;
      reason: string;
      expiresAt: string | null;
    }) => {
      const reason = v.reason.trim();
      if (reason.length < 3) throw new Error("Escreva o motivo.");
      const { error } = v.enable
        ? await supabase.rpc("master_enable_feature", {
            _org_id: v.orgId,
            _feature_key: v.featureKey,
            _reason: reason,
            ...(v.expiresAt ? { _expires_at: v.expiresAt } : {}),
          })
        : await supabase.rpc("master_disable_feature", {
            _org_id: v.orgId,
            _feature_key: v.featureKey,
            _reason: reason,
          });
      if (error) throw error;
    },
    onSettled: (_d, _e, v) => queryClient.invalidateQueries({ queryKey: [FEATURES_KEY, v.orgId] }),
  });
}
