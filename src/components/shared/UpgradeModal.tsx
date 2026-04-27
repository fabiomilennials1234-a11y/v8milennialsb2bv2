/**
 * UpgradeModal — modal de incentivo a upgrade quando o usuário tenta
 * acessar uma feature bloqueada pelo plano.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureLabel: string;
  featureDescription?: string;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

export function UpgradeModal({
  open,
  onOpenChange,
  featureLabel,
  featureDescription,
}: UpgradeModalProps) {
  const { planName } = useOrgFeatures();
  const currentPlanLabel = PLAN_LABELS[planName] ?? planName;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-3">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-xl text-center" style={{ letterSpacing: "-0.02em" }}>
            Desbloqueie {featureLabel}
          </DialogTitle>
          <DialogDescription className="text-center">
            Esse recurso não está disponível no plano {currentPlanLabel}.
            {featureDescription && (
              <span className="block mt-1 text-muted-foreground">
                {featureDescription}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
          <p className="text-sm font-medium">
            Faça upgrade para ter acesso a {featureLabel} e dezenas de recursos avançados para sua equipe.
          </p>
          <p className="text-xs text-muted-foreground">
            Fale com nosso time comercial — é rápido.
          </p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            className="gradient-primary gradient-primary-hover text-white font-semibold border-0"
            onClick={() => {
              window.open(
                "https://wa.me/5511999999999?text=Ol%C3%A1%2C%20gostaria%20de%20fazer%20upgrade%20do%20meu%20plano!",
                "_blank"
              );
            }}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Falar com Comercial
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
