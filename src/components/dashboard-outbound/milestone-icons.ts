import { Flame, Target, Trophy, Star, Zap, Award, Crown, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const MILESTONE_ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  target: Target,
  trophy: Trophy,
  star: Star,
  zap: Zap,
  award: Award,
  crown: Crown,
  shield: Shield,
};

export const MILESTONE_ICON_OPTIONS = Object.keys(MILESTONE_ICONS);
