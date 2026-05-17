import { Gem, Trophy, Medal, Award, XCircle, type LucideIcon } from "lucide-react";
import type { QualificationTier } from "./types";

interface TierConfig {
  label: string;
  icon: LucideIcon;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}

export const QUALIFICATION_TIER_CONFIG: Record<QualificationTier, TierConfig> = {
  diamante: {
    label: "Diamante",
    icon: Gem,
    colorClass: "text-cyan-300",
    bgClass: "bg-cyan-500/10",
    borderClass: "border-cyan-500/30",
  },
  ouro: {
    label: "Ouro",
    icon: Trophy,
    colorClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/30",
  },
  prata: {
    label: "Prata",
    icon: Medal,
    colorClass: "text-zinc-300",
    bgClass: "bg-zinc-500/10",
    borderClass: "border-zinc-500/30",
  },
  bronze: {
    label: "Bronze",
    icon: Award,
    colorClass: "text-orange-500",
    bgClass: "bg-orange-500/10",
    borderClass: "border-orange-500/30",
  },
  desqualificado: {
    label: "Desqualificado",
    icon: XCircle,
    colorClass: "text-red-500",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/30",
  },
};
