import { motion } from "framer-motion";
import { Crown, Star, Zap, Flame, Rocket, Diamond, Award } from "lucide-react";
import { cn } from "@/lib/utils";

interface LevelBadgeProps {
  level: number;
  xp: number;
  xpToNextLevel: number;
  size?: "sm" | "md" | "lg";
  showProgress?: boolean;
}

/**
 * V5: cada nível pinta com um token (o degradê cru não tinha par no escuro).
 * `gradient` = preenchimento do selo e da barra de XP; `color` = texto do nome.
 * Ouro/prata/bronze seguem o pódio; os níveis altos sobem para tinta + ouro.
 */
const levelConfig: Record<number, { 
  name: string; 
  icon: typeof Star; 
  gradient: string;
  color: string;
}> = {
  1: { name: "Iniciante", icon: Star, gradient: "bg-muted-foreground text-background", color: "text-muted-foreground" },
  2: { name: "Bronze", icon: Award, gradient: "bg-warning text-warning-foreground", color: "text-warning-strong" },
  3: { name: "Prata", icon: Award, gradient: "bg-silver text-silver-foreground", color: "text-silver" },
  4: { name: "Ouro", icon: Crown, gradient: "bg-primary text-primary-foreground", color: "text-primary-soft-foreground" },
  5: { name: "Platina", icon: Diamond, gradient: "bg-insights text-insights-foreground", color: "text-insights" },
  6: { name: "Diamante", icon: Diamond, gradient: "bg-insights text-insights-foreground", color: "text-insights" },
  7: { name: "Mestre", icon: Flame, gradient: "bg-warning text-warning-foreground", color: "text-warning-strong" },
  8: { name: "Grão-Mestre", icon: Rocket, gradient: "bg-destructive text-destructive-foreground", color: "text-destructive" },
  9: { name: "Lendário", icon: Zap, gradient: "bg-tinta text-primary", color: "text-primary-soft-foreground" },
  10: { name: "Supremo", icon: Crown, gradient: "bg-tinta text-primary", color: "text-primary-soft-foreground" },
};

const sizeConfig = {
  sm: { badge: "w-8 h-8", icon: "w-4 h-4", text: "text-xs" },
  md: { badge: "w-12 h-12", icon: "w-6 h-6", text: "text-sm" },
  lg: { badge: "w-16 h-16", icon: "w-8 h-8", text: "text-base" },
};

export function LevelBadge({ 
  level, 
  xp, 
  xpToNextLevel, 
  size = "md",
  showProgress = true 
}: LevelBadgeProps) {
  const config = levelConfig[Math.min(level, 10)] || levelConfig[1];
  const Icon = config.icon;
  const sizes = sizeConfig[size];
  const progress = (xp / xpToNextLevel) * 100;

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="flex flex-col items-center gap-2"
    >
      {/* Level Badge */}
      <div className="relative">
        <motion.div
          whileHover={{ scale: 1.1, rotate: 5 }}
          className={cn(
            sizes.badge,
            "rounded-full flex items-center justify-center",
            config.gradient,
            "shadow-relevo border-2 border-card"
          )}
        >
          <Icon className={sizes.icon} />
        </motion.div>
        
        {/* Level Number */}
        <div className="absolute -bottom-1 -right-1 bg-card border border-card-border shadow-relevo rounded-full w-5 h-5 flex items-center justify-center">
          <span className="text-[10.5px] font-extrabold tabular-nums">{level}</span>
        </div>

        {/* Glow effect */}
        <div 
          className={cn(
            "absolute inset-0 rounded-full blur-lg opacity-30 -z-10",
            config.gradient
          )} 
        />
      </div>

      {/* Level Name */}
      <span className={cn(sizes.text, "font-bold", config.color)}>
        {config.name}
      </span>

      {/* XP Progress */}
      {showProgress && (
        <div className="w-full max-w-[100px]">
          <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground mb-1">
            <span>{xp} XP</span>
            <span>{xpToNextLevel} XP</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={cn("h-full rounded-full", config.gradient)}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}

// Calculate level from XP
export function calculateLevel(totalXp: number): { level: number; xp: number; xpToNextLevel: number } {
  const xpPerLevel = 1000;
  const level = Math.floor(totalXp / xpPerLevel) + 1;
  const xp = totalXp % xpPerLevel;
  const xpToNextLevel = xpPerLevel;
  
  return { level: Math.min(level, 10), xp, xpToNextLevel };
}
