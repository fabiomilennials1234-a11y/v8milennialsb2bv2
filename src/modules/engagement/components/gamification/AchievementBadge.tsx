import { motion } from "framer-motion";
import { Trophy, Star, Flame, Target, Medal, Crown, Zap, Rocket, Award, TrendingUp } from "lucide-react";

export type BadgeType = 
  | "bronze" 
  | "silver" 
  | "gold" 
  | "platinum" 
  | "first_sale" 
  | "streak" 
  | "overachiever" 
  | "top_seller"
  | "rising_star"
  | "goal_crusher";

interface AchievementBadgeProps {
  type: BadgeType;
  title: string;
  description?: string;
  earned?: boolean;
  size?: "sm" | "md" | "lg";
  showTooltip?: boolean;
}

/**
 * V5: cada tipo de conquista pinta com um TOKEN, não com degradê cru — o
 * degradê `from-amber-600 to-amber-800` não tinha par no escuro. Medalhas
 * seguem o pódio (ouro = primary, prata = silver, bronze = warning); os demais
 * tipos usam a cor semântica mais próxima do significado. `gradient` guarda o
 * preenchimento conquistado (nome mantido para não mexer na forma do mapa).
 */
const badgeConfig: Record<BadgeType, { 
  icon: typeof Trophy; 
  gradient: string;
  bgColor: string;
  borderColor: string;
}> = {
  bronze: {
    icon: Medal,
    gradient: "bg-warning text-warning-foreground",
    bgColor: "bg-warning/15",
    borderColor: "border-warning/60",
  },
  silver: {
    icon: Medal,
    gradient: "bg-silver text-silver-foreground",
    bgColor: "bg-silver/15",
    borderColor: "border-silver/60",
  },
  gold: {
    icon: Trophy,
    gradient: "bg-primary text-primary-foreground",
    bgColor: "bg-primary-soft",
    borderColor: "border-primary/60",
  },
  platinum: {
    icon: Crown,
    gradient: "bg-tinta text-tinta-foreground",
    bgColor: "bg-muted",
    borderColor: "border-tinta-line",
  },
  first_sale: {
    icon: Star,
    gradient: "bg-success text-success-foreground",
    bgColor: "bg-success/10",
    borderColor: "border-success/60",
  },
  streak: {
    icon: Flame,
    gradient: "bg-warning text-warning-foreground",
    bgColor: "bg-warning/15",
    borderColor: "border-warning/60",
  },
  overachiever: {
    icon: Rocket,
    gradient: "bg-insights text-insights-foreground",
    bgColor: "bg-insights/10",
    borderColor: "border-insights/60",
  },
  top_seller: {
    icon: Crown,
    gradient: "bg-tinta text-primary",
    bgColor: "bg-primary-soft",
    borderColor: "border-primary/60",
  },
  rising_star: {
    icon: TrendingUp,
    gradient: "bg-insights text-insights-foreground",
    bgColor: "bg-insights/10",
    borderColor: "border-insights/60",
  },
  goal_crusher: {
    icon: Target,
    gradient: "bg-destructive text-destructive-foreground",
    bgColor: "bg-destructive/10",
    borderColor: "border-destructive/60",
  },
};

const sizeStyles = {
  sm: "w-10 h-10",
  md: "w-14 h-14",
  lg: "w-20 h-20",
};

const iconSizes = {
  sm: "w-5 h-5",
  md: "w-7 h-7",
  lg: "w-10 h-10",
};

export function AchievementBadge({
  type,
  title,
  description,
  earned = true,
  size = "md",
}: AchievementBadgeProps) {
  const config = badgeConfig[type];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.05 }}
      className="flex flex-col items-center gap-2"
    >
      <div
        className={`relative ${sizeStyles[size]} rounded-full flex items-center justify-center border-2 ${
          earned 
            ? `${config.gradient} ${config.borderColor} shadow-relevo` 
            : "bg-muted border-border text-muted-foreground/50"
        }`}
      >
        <Icon 
          className={iconSizes[size]} 
        />
        {earned && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="absolute -top-1 -right-1 w-4 h-4 bg-success rounded-full flex items-center justify-center ring-2 ring-card"
          >
            <Zap className="w-2.5 h-2.5 text-success-foreground" />
          </motion.div>
        )}
      </div>
      <div className="text-center">
        <p className={`text-xs font-bold tracking-[-0.01em] ${earned ? "text-foreground" : "text-muted-foreground"}`}>
          {title}
        </p>
        {description && (
          <p className="text-[10px] text-muted-foreground">{description}</p>
        )}
      </div>
    </motion.div>
  );
}

export function AchievementRow({ 
  achievements 
}: { 
  achievements: Array<{ type: BadgeType; title: string; earned: boolean }> 
}) {
  return (
    <div className="flex items-center gap-4 overflow-x-auto pb-2">
      {achievements.map((achievement, index) => (
        <motion.div
          key={achievement.type}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <AchievementBadge
            type={achievement.type}
            title={achievement.title}
            earned={achievement.earned}
            size="sm"
          />
        </motion.div>
      ))}
    </div>
  );
}
