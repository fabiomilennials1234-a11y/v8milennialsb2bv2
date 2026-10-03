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
      <div className="h-16 w-16 rounded-2xl bg-warning/15 flex items-center justify-center mb-5">
        <Lock className="h-8 w-8 text-warning-strong" />
      </div>
      <h2 className="mb-2 text-2xl font-extrabold tracking-[-0.035em]">{label} está bloqueado</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        {target
          ? <>Disponível no plano <strong>{target}</strong>. {meta?.description}</>
          : <>Esse recurso não está no seu plano atual. {meta?.description}</>}
      </p>
      <Button onClick={handleUpgrade}>
        <Sparkles />
        {target ? "Fazer upgrade" : "Falar com Comercial"}
      </Button>
    </div>
  );
}
