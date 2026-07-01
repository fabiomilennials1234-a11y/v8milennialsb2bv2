import type { ReactNode } from "react";
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
 * Envolve uma rota. Feature liberada (ou ainda carregando) → renderiza o
 * módulo. Bloqueada → renderiza FeatureLockedScreen. Fecha o bypass de URL.
 */
export function FeatureRoute({ children, feature, path }: FeatureRouteProps) {
  const { hasFeature, isReady } = useOrgFeatures();
  const key = feature ?? (path ? SIDEBAR_FEATURE_MAP[path] : undefined);

  if (!key) return <>{children}</>;
  if (!isReady) return <>{children}</>;
  if (hasFeature(key)) return <>{children}</>;

  return <FeatureLockedScreen feature={key} />;
}
