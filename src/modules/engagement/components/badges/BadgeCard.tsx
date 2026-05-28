import { motion } from "framer-motion";
import {
  Flame, Target, TrendingUp, Repeat, BadgeDollarSign,
  Zap, Trophy, Award, Lock, Star, Crown, Shield,
} from "lucide-react";
import type { Badge } from "@/modules/engagement/hooks/useBadges";

// Mapa de ícone string → componente Lucide
const ICON_MAP: Record<string, React.ElementType> = {
  flame: Flame,
  target: Target,
  "trending-up": TrendingUp,
  repeat: Repeat,
  "badge-dollar-sign": BadgeDollarSign,
  zap: Zap,
  trophy: Trophy,
  award: Award,
  star: Star,
  crown: Crown,
  shield: Shield,
};

interface BadgeCardProps {
  badge: Badge;
  unlocked: boolean;
  currentValue?: number;
}

export function BadgeCard({ badge, unlocked, currentValue }: BadgeCardProps) {
  const Icon = ICON_MAP[badge.icon ?? ""] ?? Trophy;
  const progress = currentValue != null
    ? Math.min((currentValue / badge.criteria_value) * 100, 100)
    : 0;

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.03 }}
      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${
        unlocked
          ? "bg-gradient-to-br from-primary/5 to-primary/10 border-primary/30"
          : "bg-muted/30 border-muted-foreground/10"
      }`}
    >
      {/* Ícone */}
      <div
        className={`relative w-14 h-14 rounded-full flex items-center justify-center border-2 ${
          unlocked
            ? "bg-gradient-to-br from-primary to-primary/80 border-primary/50 shadow-lg shadow-primary/20"
            : "bg-muted border-muted-foreground/20"
        }`}
      >
        {unlocked ? (
          <Icon className="w-7 h-7 text-primary-foreground" />
        ) : (
          <Lock className="w-6 h-6 text-muted-foreground/40" />
        )}
        {unlocked && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center"
          >
            <Zap className="w-3 h-3 text-white" />
          </motion.div>
        )}
      </div>

      {/* Nome e descrição */}
      <div className="text-center">
        <p className={`text-xs font-semibold ${unlocked ? "text-foreground" : "text-muted-foreground"}`}>
          {badge.name}
        </p>
        {badge.description && (
          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
            {badge.description}
          </p>
        )}
      </div>

      {/* Progresso (se não desbloqueado) */}
      {!unlocked && currentValue != null && (
        <div className="w-full space-y-1">
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/60 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            {currentValue}/{badge.criteria_value}
          </p>
        </div>
      )}
    </motion.div>
  );
}
