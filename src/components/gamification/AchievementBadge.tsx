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

const badgeConfig: Record<BadgeType, { 
  icon: typeof Trophy; 
  gradient: string;
  bgColor: string;
  borderColor: string;
}> = {
  bronze: {
    icon: Medal,
    gradient: "from-amber-600 to-amber-800",
    bgColor: "bg-amber-100",
    borderColor: "border-amber-400",
  },
  silver: {
    icon: Medal,
    gradient: "from-slate-300 to-slate-500",
    bgColor: "bg-slate-100",
    borderColor: "border-slate-400",
  },
  gold: {
    icon: Trophy,
    gradient: "from-yellow-400 to-amber-500",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-400",
  },
  platinum: {
    icon: Crown,
    gradient: "from-cyan-300 to-blue-500",
    bgColor: "bg-cyan-50",
    borderColor: "border-cyan-400",
  },
  first_sale: {
    icon: Star,
    gradient: "from-green-400 to-emerald-500",
    bgColor: "bg-green-50",
    borderColor: "border-green-400",
  },
  streak: {
    icon: Flame,
    gradient: "from-orange-400 to-red-500",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-400",
  },
  overachiever: {
    icon: Rocket,
    gradient: "from-purple-400 to-pink-500",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-400",
  },
  top_seller: {
    icon: Crown,
    gradient: "from-yellow-400 to-orange-500",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-500",
  },
  rising_star: {
    icon: TrendingUp,
    gradient: "from-blue-400 to-indigo-500",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-400",
  },
  goal_crusher: {
    icon: Target,
    gradient: "from-red-400 to-pink-500",
    bgColor: "bg-red-50",
    borderColor: "border-red-400",
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
            ? `bg-gradient-to-br ${config.gradient} ${config.borderColor} shadow-lg` 
            : "bg-muted border-muted-foreground/30"
        }`}
      >
        <Icon 
          className={`${iconSizes[size]} ${earned ? "text-white" : "text-muted-foreground/50"}`} 
        />
        {earned && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="absolute -top-1 -right-1 w-4 h-4 bg-success rounded-full flex items-center justify-center"
          >
            <Zap className="w-2.5 h-2.5 text-white" />
          </motion.div>
        )}
      </div>
      <div className="text-center">
        <p className={`text-xs font-semibold ${earned ? "text-foreground" : "text-muted-foreground"}`}>
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
