/**
 * OrgFeaturesContext — carrega features e limites da org via RPC e
 * expõe helpers (hasFeature, checkLimit, canCreateCampaign) para toda a árvore.
 *
 * Uso:
 *   const { hasFeature, checkLimit } = useOrgFeatures();
 *   if (!hasFeature("copilot")) showUpgradeModal();
 *   if (checkLimit("max_leads") !== -1 && currentLeads >= checkLimit("max_leads")) ...
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { FeatureKey, LimitKey } from "@/lib/feature-registry";

// ─── Types ─────────────────────────────────────────────────────
interface FeaturesAndLimits {
  features: Record<string, boolean>;
  limits: Record<string, number>;
  plan_name: string;
}

interface OrgFeaturesContextType {
  /** Verifica se a org tem acesso a uma feature */
  hasFeature: (key: FeatureKey) => boolean;
  /** Retorna o limite numérico. -1 = ilimitado, 0 = sem acesso */
  checkLimit: (key: LimitKey) => number;
  /** Verifica se um tipo de campanha pode ser criado */
  canCreateCampaign: (type: "manual" | "semi_automatica" | "automatica") => boolean;
  /** Nome do plano atual */
  planName: string;
  /** Todas as features (para o editor de planos no Master) */
  allFeatures: Record<string, boolean>;
  /** Todos os limites */
  allLimits: Record<string, number>;
  /** Loading state */
  isLoading: boolean;
  /** Se o contexto está pronto (org carregada + dados retornados) */
  isReady: boolean;
}

const OrgFeaturesContext = createContext<OrgFeaturesContextType | undefined>(undefined);

// ─── Campaign type → feature key ──────────────────────────────
const CAMPAIGN_FEATURE: Record<string, FeatureKey> = {
  manual: "campaigns_manual",
  semi_automatica: "campaigns_semi",
  automatica: "campaigns_auto",
};

// ─── Provider ──────────────────────────────────────────────────
export function OrgFeaturesProvider({ children }: { children: ReactNode }) {
  const { organizationId, isLoading: orgLoading } = useOrganization();

  const { data, isLoading: queryLoading } = useQuery<FeaturesAndLimits>({
    queryKey: ["org-features", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("org_get_features_and_limits", {
        p_org_id: organizationId!,
      });
      if (error) throw error;
      return data as unknown as FeaturesAndLimits;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 min
    gcTime: 10 * 60 * 1000,
  });

  const value = useMemo<OrgFeaturesContextType>(() => {
    const features = data?.features ?? {};
    const limits = data?.limits ?? {};
    const planName = data?.plan_name ?? "free";
    const isLoading = orgLoading || queryLoading;
    const isReady = !isLoading && !!data;

    return {
      hasFeature: (key: FeatureKey) => {
        // Se ainda carregando, libera tudo para evitar flash de lock
        if (!isReady) return true;
        return features[key] === true;
      },
      checkLimit: (key: LimitKey) => {
        if (!isReady) return -1;
        return typeof limits[key] === "number" ? limits[key] : 0;
      },
      canCreateCampaign: (type) => {
        if (!isReady) return true;
        const featureKey = CAMPAIGN_FEATURE[type];
        return featureKey ? features[featureKey] === true : true;
      },
      planName,
      allFeatures: features,
      allLimits: limits,
      isLoading,
      isReady,
    };
  }, [data, orgLoading, queryLoading]);

  return (
    <OrgFeaturesContext.Provider value={value}>
      {children}
    </OrgFeaturesContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────
export function useOrgFeatures(): OrgFeaturesContextType {
  const ctx = useContext(OrgFeaturesContext);
  if (!ctx) {
    throw new Error("useOrgFeatures must be used within an OrgFeaturesProvider");
  }
  return ctx;
}
