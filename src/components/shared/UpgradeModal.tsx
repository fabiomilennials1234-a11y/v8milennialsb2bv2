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
import { Lock, Sparkles } from "lucide-react";
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
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Lock className="h-5 w-5 text-amber-500" />
            </div>
            <DialogTitle className="text-lg">Recurso Bloqueado</DialogTitle>
          </div>
          <DialogDescription className="text-left">
            <span className="font-semibold text-foreground">{featureLabel}</span>{" "}
            não está disponível no seu plano atual ({currentPlanLabel}).
            {featureDescription && (
              <span className="block mt-1 text-muted-foreground">
                {featureDescription}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Desbloqueie com upgrade</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Faça upgrade do seu plano para ter acesso a {featureLabel} e muitos
            outros recursos avançados. Fale com nosso time comercial.
          </p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
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
