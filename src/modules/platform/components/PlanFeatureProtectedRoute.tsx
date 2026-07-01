/**
 * PlanFeatureProtectedRoute — guard de rota por feature de plano.
 *
 * Complementa o cadeado da navegação (TopNavigation.isLocked): mesmo chegando
 * por URL direta, deep link, atalho ou command palette, a rota de uma feature
 * fora do plano renderiza o estado bloqueado com CTA de upgrade.
 *
 * - Master sempre passa (org_get_features_and_limits retorna tudo true).
 * - Enquanto as features carregam, renderiza children — mesma convenção de
 *   hasFeature (evita flash de lock na navegação normal).
 */

import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { PLAN_LABELS, UPGRADE_CONTACT_URL } from "@/shared/components/UpgradeModal";
import type { FeatureKey } from "@/modules/platform/lib/feature-registry";

interface PlanFeatureProtectedRouteProps {
  /** Feature key do plano que libera esta rota. */
  feature: FeatureKey;
  /** Nome exibido no estado bloqueado (ex.: "Copilot"). */
  featureLabel: string;
  children: ReactNode;
}

export function PlanFeatureProtectedRoute({
  feature,
  featureLabel,
  children,
}: PlanFeatureProtectedRouteProps) {
  const { hasFeature, planName } = useOrgFeatures();
  const navigate = useNavigate();

  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  const planLabel = PLAN_LABELS[planName] ?? planName;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold" style={{ letterSpacing: "-0.02em" }}>
          Desbloqueie {featureLabel}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Esse recurso não está disponível no plano {planLabel}. Faça upgrade
          para liberar {featureLabel} e dezenas de recursos avançados para sua
          equipe.
        </p>
        <div className="mt-8 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Voltar ao início
          </Button>
          <Button
            className="gradient-primary gradient-primary-hover border-0 font-semibold text-white"
            onClick={() => window.open(UPGRADE_CONTACT_URL, "_blank")}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Falar com Comercial
          </Button>
        </div>
      </div>
    </div>
  );
}
