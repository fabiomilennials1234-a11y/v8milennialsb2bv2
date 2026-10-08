import { useState, type ReactNode, type MouseEvent } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { UpgradeModal } from "@/shared/components/UpgradeModal";
import type { FeatureKey } from "@/modules/platform/lib/feature-registry";

type Variant = "inline" | "wrapper" | "iconOnly";

interface FeatureLockProps {
  feature: FeatureKey;
  children: ReactNode;
  variant?: Variant;
  className?: string;
}

/**
 * Envolve qualquer conteúdo gated. Feature liberada → renderiza children.
 * Bloqueada → adiciona cadeado, intercepta o click e abre o UpgradeModal.
 * Enquanto features carregam (!isReady) → não trava (evita flash de cadeado).
 */
export function FeatureLock({ feature, children, variant = "inline", className }: FeatureLockProps) {
  const { hasFeature, isReady } = useOrgFeatures();
  const [modalOpen, setModalOpen] = useState(false);

  const locked = isReady && !hasFeature(feature);

  if (!locked) return <>{children}</>;

  const intercept = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModalOpen(true);
  };

  const icon = <Lock data-testid="feature-lock-icon" className="w-3 h-3 text-amber-500 shrink-0" />;

  return (
    <>
      <span
        onClickCapture={intercept}
        aria-disabled
        className={cn(
          "inline-flex items-center gap-1.5",
          variant !== "iconOnly" && "[&_*]:pointer-events-none cursor-not-allowed opacity-90",
          className
        )}
      >
        {variant !== "iconOnly" && children}
        {icon}
      </span>
      <UpgradeModal open={modalOpen} onOpenChange={setModalOpen} featureKey={feature} />
    </>
  );
}
