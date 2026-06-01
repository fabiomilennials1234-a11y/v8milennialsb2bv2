import { memo } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QualificationTier } from "../../lead-detail/modal/types";
import { QUALIFICATION_TIER_CONFIG } from "../../lead-detail/modal/qualification-config";

/**
 * Avatar do lead no LeadCard: 32px, dividido em metades verticais
 * (esquerda = pré-qualificação, direita = qualificação). Se vazio, "?".
 *
 * Versão compacta do componente do modal — sem tooltip (evita conflito com
 * o drag handle do card).
 */
interface LeadCardAvatarProps {
  preQualTier?: QualificationTier | null;
  qualTier?: QualificationTier | null;
  avatarUrl?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}

export const LeadCardAvatar = memo(function LeadCardAvatar({
  preQualTier,
  qualTier,
  avatarUrl,
  name,
  size = 32,
  className,
}: LeadCardAvatarProps) {
  const iconSize = Math.round(size * 0.42);
  const unifiedIconSize = Math.round(size * 0.6);
  const leftConfig  = preQualTier ? QUALIFICATION_TIER_CONFIG[preQualTier] : null;
  const rightConfig = qualTier    ? QUALIFICATION_TIER_CONFIG[qualTier]    : null;
  const LeftIcon  = leftConfig?.icon;
  const RightIcon = rightConfig?.icon;
  const isUnified = !!preQualTier && preQualTier === qualTier;

  return (
    <div
      style={{ width: size, height: size }}
      className={cn(
        "relative rounded-full shrink-0 border border-border/50 overflow-hidden",
        className,
      )}
      role="img"
      aria-label={`Qualificação${name ? ` ${name}` : ""}`}
    >
      {isUnified && LeftIcon ? (
        <div className={cn("absolute inset-0 flex items-center justify-center", leftConfig?.bgClass)}>
          <LeftIcon
            className={cn(leftConfig?.colorClass)}
            style={{ width: unifiedIconSize, height: unifiedIconSize }}
          />
        </div>
      ) : (
        <>
          <div
            className={cn(
              "absolute inset-y-0 left-0 w-1/2 flex items-center justify-end pr-px",
              leftConfig ? leftConfig.bgClass : "bg-muted/40",
            )}
          >
            {LeftIcon ? (
              <LeftIcon className={cn(leftConfig?.colorClass)} style={{ width: iconSize, height: iconSize }} />
            ) : (
              <HelpCircle className="text-muted-foreground/50" style={{ width: iconSize, height: iconSize }} />
            )}
          </div>

          <div
            className={cn(
              "absolute inset-y-0 right-0 w-1/2 flex items-center justify-start pl-px",
              rightConfig ? rightConfig.bgClass : "bg-muted/20",
            )}
          >
            {RightIcon ? (
              <RightIcon className={cn(rightConfig?.colorClass)} style={{ width: iconSize, height: iconSize }} />
            ) : (
              <HelpCircle className="text-muted-foreground/50" style={{ width: iconSize, height: iconSize }} />
            )}
          </div>

          <div className="absolute top-[12%] bottom-[12%] left-1/2 w-px bg-border/30 -translate-x-1/2" />
        </>
      )}

      {avatarUrl && (
        <img
          src={avatarUrl}
          alt={name || "Lead"}
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
    </div>
  );
});
