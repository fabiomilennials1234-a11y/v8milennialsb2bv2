import { memo } from "react";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { QualificationTier } from "../types";
import { QUALIFICATION_TIER_CONFIG } from "../qualification-config";

interface LeadAvatarProps {
  avatarUrl?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  /** Pré-qualificação (metade esquerda). */
  preQualTier?: QualificationTier | null;
  /** Qualificação (metade direita). */
  qualTier?: QualificationTier | null;
}

/**
 * Avatar do lead. Dividido implicitamente em duas metades verticais:
 *   • Esquerda = pré-qualificação
 *   • Direita = qualificação
 *
 * Cada metade renderiza ícone+cor do tier correspondente. Metade vazia
 * mostra "?" em cinza neutro. Quando há `avatarUrl`, ela sobrepõe a
 * divisão (preservando o slot para automação futura).
 */
export const LeadAvatar = memo(function LeadAvatar({
  avatarUrl,
  name,
  size = 56,
  className,
  preQualTier,
  qualTier,
}: LeadAvatarProps) {
  const hasAvatar = !!avatarUrl;
  const iconSize = Math.round(size * 0.32);
  const unifiedIconSize = Math.round(size * 0.5);

  const leftConfig  = preQualTier ? QUALIFICATION_TIER_CONFIG[preQualTier] : null;
  const rightConfig = qualTier    ? QUALIFICATION_TIER_CONFIG[qualTier]    : null;
  const LeftIcon  = leftConfig?.icon;
  const RightIcon = rightConfig?.icon;

  const isUnified = !!preQualTier && preQualTier === qualTier;

  const inner = (
    <div
      style={{ width: size, height: size }}
      className={cn(
        "relative rounded-full shrink-0 border border-border/40 overflow-hidden",
        className,
      )}
      role="img"
      aria-label={`Avatar do lead${name ? ` ${name}` : ""}`}
    >
      {isUnified && LeftIcon ? (
        /* Unificado — ícone único cobrindo todo avatar */
        <div className={cn("absolute inset-0 flex items-center justify-center", leftConfig?.bgClass)}>
          <LeftIcon
            className={cn(leftConfig?.colorClass)}
            style={{ width: unifiedIconSize, height: unifiedIconSize }}
          />
        </div>
      ) : (
        <>
          {/* Half — left (pré-qualificação) */}
          <div
            className={cn(
              "absolute inset-y-0 left-0 w-1/2 flex items-center justify-end pr-[2px]",
              leftConfig ? cn(leftConfig.bgClass) : "bg-muted/40",
            )}
          >
            {LeftIcon ? (
              <LeftIcon
                className={cn(leftConfig?.colorClass)}
                style={{ width: iconSize, height: iconSize }}
              />
            ) : (
              <HelpCircle
                className="text-muted-foreground/50"
                style={{ width: iconSize, height: iconSize }}
              />
            )}
          </div>

          {/* Half — right (qualificação) */}
          <div
            className={cn(
              "absolute inset-y-0 right-0 w-1/2 flex items-center justify-start pl-[2px]",
              rightConfig ? cn(rightConfig.bgClass) : "bg-muted/20",
            )}
          >
            {RightIcon ? (
              <RightIcon
                className={cn(rightConfig?.colorClass)}
                style={{ width: iconSize, height: iconSize }}
              />
            ) : (
              <HelpCircle
                className="text-muted-foreground/50"
                style={{ width: iconSize, height: iconSize }}
              />
            )}
          </div>

          {/* Divider central — sutil */}
          <div className="absolute top-[10%] bottom-[10%] left-1/2 w-px bg-border/30 -translate-x-1/2" />
        </>
      )}

      {/* Foto override — quando avatar_url existir (preenchido por automação) */}
      {hasAvatar && (
        <img
          src={avatarUrl!}
          alt={name || "Lead"}
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
    </div>
  );

  if (hasAvatar) return inner;

  const tooltipText = (() => {
    const parts: string[] = [];
    parts.push(leftConfig  ? `Pré-Qualificação: ${leftConfig.label}`  : "Pré-Qualificação: —");
    parts.push(rightConfig ? `Qualificação: ${rightConfig.label}`    : "Qualificação: —");
    return parts.join(" · ");
  })();

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
