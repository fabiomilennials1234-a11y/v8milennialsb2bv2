import { Gem, Trophy, Medal, Award, XCircle, type LucideIcon } from "lucide-react";
import type { QualificationTier } from "./types";

interface TierConfig {
  label: string;
  icon: LucideIcon;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}

/**
 * Cores dos tiers — V5: só tokens, legíveis nos dois temas (mesmo mapa do
 * mockup aprovado: Diamante = info, Ouro = ouro suave, Prata = neutro,
 * Bronze = âmbar, Desqualificado = vermelho). A paleta anterior
 * (`text-insights`, `text-silver`) era clara demais e sumia no tema claro.
 */
export const QUALIFICATION_TIER_CONFIG: Record<QualificationTier, TierConfig> = {
  diamante: {
    label: "Diamante",
    icon: Gem,
    colorClass: "text-insights",
    bgClass: "bg-insights/10",
    borderClass: "border-insights/30",
  },
  ouro: {
    label: "Ouro",
    icon: Trophy,
    colorClass: "text-primary-soft-foreground",
    bgClass: "bg-primary-soft",
    borderClass: "border-primary/40",
  },
  prata: {
    label: "Prata",
    icon: Medal,
    colorClass: "text-silver",
    bgClass: "bg-silver/15",
    borderClass: "border-silver/40",
  },
  bronze: {
    label: "Bronze",
    icon: Award,
    colorClass: "text-warning-strong",
    bgClass: "bg-warning/10",
    borderClass: "border-warning/30",
  },
  desqualificado: {
    label: "Desqualificado",
    icon: XCircle,
    colorClass: "text-destructive",
    bgClass: "bg-destructive/10",
    borderClass: "border-destructive/30",
  },
};
