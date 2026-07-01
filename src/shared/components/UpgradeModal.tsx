/**
 * UpgradeModal v2 — incentivo a upgrade quando o usuário toca uma feature
 * bloqueada pelo plano. Deriva o plano-alvo de featureUnlockPlan (DB).
 */

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { getFeatureMeta, type FeatureKey } from "@/modules/platform/lib/feature-registry";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureKey: FeatureKey;
}

export function UpgradeModal({ open, onOpenChange, featureKey }: UpgradeModalProps) {
  const navigate = useNavigate();
  const { featureUnlockPlan } = useOrgFeatures();

  const meta = getFeatureMeta(featureKey);
  const featureLabel = meta?.label ?? featureKey;
  const target = featureUnlockPlan[featureKey];
  const targetName = target?.display_name;

  const handleUpgrade = () => {
    const url = import.meta.env.VITE_UPGRADE_CONTACT_URL as string | undefined;
    if (url) {
      window.open(url, "_blank", "noopener");
    } else {
      navigate("/configuracoes");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-3">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Lock className="h-6 w-6 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-xl text-center" style={{ letterSpacing: "-0.02em" }}>
            Desbloqueie {featureLabel}
          </DialogTitle>
          <DialogDescription className="text-center">
            {targetName
              ? <>Esse recurso está disponível no plano <strong>{targetName}</strong>.</>
              : <>Esse recurso não está disponível no seu plano atual.</>}
            {meta?.description && (
              <span className="block mt-1 text-muted-foreground">{meta.description}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
          <p className="text-sm font-medium">
            {targetName
              ? <>Faça upgrade para o {targetName} e libere {featureLabel} e os demais recursos do plano.</>
              : <>Fale com nosso time para liberar {featureLabel}.</>}
          </p>
          <p className="text-xs text-muted-foreground">Nosso time resolve rápido.</p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button
            className="gradient-primary gradient-primary-hover text-white font-semibold border-0"
            onClick={handleUpgrade}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {targetName ? "Fazer upgrade" : "Falar com Comercial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
