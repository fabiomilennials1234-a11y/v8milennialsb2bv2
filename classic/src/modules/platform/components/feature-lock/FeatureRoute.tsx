import type { ReactNode } from "react";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { SIDEBAR_FEATURE_MAP, type FeatureKey } from "@/modules/platform/lib/feature-registry";
import { FeatureLockedScreen } from "./FeatureLockedScreen";

interface FeatureRouteProps {
  children: ReactNode;
  /** Feature key explícita. Se ausente, resolve por `path` via SIDEBAR_FEATURE_MAP. */
  feature?: FeatureKey;
  path?: string;
}

/**
 * Envolve uma rota. Feature liberada → renderiza o módulo. Bloqueada →
 * FeatureLockedScreen. Fecha o bypass de URL direta/deep link/palette.
 *
 * ESTRITO no loading (plan-tiers-cleanup): espera isReady com loader neutro
 * e só então decide. hasFeature do contexto é fail-open no loading (anti-flash
 * na nav) — confiar nele aqui abria janela de acesso a rota bloqueada.
 * Fonte única dos paths: ROUTE_FEATURE_MAP (consistência nav↔rota enforced
 * por tests/unit/route-feature-map.test.ts).
 */
export function FeatureRoute({ children, feature, path }: FeatureRouteProps) {
  const { hasFeature, isReady } = useOrgFeatures();
  const key = feature ?? (path ? SIDEBAR_FEATURE_MAP[path] : undefined);

  if (!key) return <>{children}</>;
  if (!isReady) return <TorqueLoader variant="inline" />;
  if (hasFeature(key)) return <>{children}</>;

  return <FeatureLockedScreen feature={key} />;
}
