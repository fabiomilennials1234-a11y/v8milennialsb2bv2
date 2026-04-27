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

const levelConfig: Record<number, { 
  name: string; 
  icon: typeof Star; 
  gradient: string;
  color: string;
}> = {
  1: { name: "Iniciante", icon: Star, gradient: "from-slate-400 to-slate-500", color: "text-slate-500" },
  2: { name: "Bronze", icon: Award, gradient: "from-amber-600 to-amber-700", color: "text-amber-600" },
  3: { name: "Prata", icon: Award, gradient: "from-slate-300 to-slate-400", color: "text-slate-400" },
  4: { name: "Ouro", icon: Crown, gradient: "from-yellow-400 to-amber-500", color: "text-yellow-500" },
  5: { name: "Platina", icon: Diamond, gradient: "from-cyan-300 to-blue-500", color: "text-cyan-500" },
  6: { name: "Diamante", icon: Diamond, gradient: "from-purple-400 to-pink-500", color: "text-purple-500" },
  7: { name: "Mestre", icon: Flame, gradient: "from-orange-400 to-red-500", color: "text-orange-500" },
  8: { name: "Grão-Mestre", icon: Rocket, gradient: "from-red-500 to-pink-600", color: "text-red-500" },
  9: { name: "Lendário", icon: Zap, gradient: "from-yellow-300 to-orange-500", color: "text-yellow-400" },
  10: { name: "Supremo", icon: Crown, gradient: "from-yellow-400 via-orange-500 to-red-500", color: "text-yellow-400" },
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
            "bg-gradient-to-br",
            config.gradient,
            "shadow-lg border-2 border-white/20"
          )}
        >
          <Icon className={cn(sizes.icon, "text-white drop-shadow-lg")} />
        </motion.div>
        
        {/* Level Number */}
        <div className="absolute -bottom-1 -right-1 bg-background border border-border rounded-full w-5 h-5 flex items-center justify-center">
          <span className="text-xs font-bold">{level}</span>
        </div>

        {/* Glow effect */}
        <div 
          className={cn(
            "absolute inset-0 rounded-full blur-lg opacity-30 bg-gradient-to-br -z-10",
            config.gradient
          )} 
        />
      </div>

      {/* Level Name */}
      <span className={cn(sizes.text, "font-semibold", config.color)}>
        {config.name}
      </span>

      {/* XP Progress */}
      {showProgress && (
        <div className="w-full max-w-[100px]">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>{xp} XP</span>
            <span>{xpToNextLevel} XP</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={cn("h-full rounded-full bg-gradient-to-r", config.gradient)}
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
