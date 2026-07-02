import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { getFeatureMeta, type FeatureKey } from "@/modules/platform/lib/feature-registry";

/** Tela cheia mostrada no lugar de um módulo bloqueado (route guard). */
export function FeatureLockedScreen({ feature }: { feature: FeatureKey }) {
  const navigate = useNavigate();
  const { featureUnlockPlan } = useOrgFeatures();
  const meta = getFeatureMeta(feature);
  const label = meta?.label ?? feature;
  const target = featureUnlockPlan[feature]?.display_name;

  const handleUpgrade = () => {
    const url = import.meta.env.VITE_UPGRADE_CONTACT_URL as string | undefined;
    if (url) window.open(url, "_blank", "noopener");
    else navigate("/configuracoes");
  };

  return (
    <div
      data-testid="feature-locked-screen"
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6"
    >
      <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-5">
        <Lock className="h-8 w-8 text-amber-500" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight mb-2">{label} está bloqueado</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        {target
          ? <>Disponível no plano <strong>{target}</strong>. {meta?.description}</>
          : <>Esse recurso não está no seu plano atual. {meta?.description}</>}
      </p>
      <Button
        className="gradient-primary gradient-primary-hover text-white font-semibold border-0"
        onClick={handleUpgrade}
      >
        <Sparkles className="w-4 h-4 mr-2" />
        {target ? "Fazer upgrade" : "Falar com Comercial"}
      </Button>
    </div>
  );
}
