import { motion } from "framer-motion";
import { Flame, Calendar, TrendingUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreakCounterProps {
  currentStreak: number;
  bestStreak: number;
  streakType?: "sales" | "meetings" | "goals";
  size?: "sm" | "md" | "lg";
}

const streakConfig = {
  sales: { label: "Vendas", icon: TrendingUp, color: "text-success" },
  meetings: { label: "Reuniões", icon: Calendar, color: "text-primary" },
  goals: { label: "Metas", icon: Zap, color: "text-insights" },
};

const sizeConfig = {
  sm: { container: "p-3", icon: "w-5 h-5", number: "text-xl", text: "text-xs" },
  md: { container: "p-4", icon: "w-6 h-6", number: "text-3xl", text: "text-sm" },
  lg: { container: "p-6", icon: "w-8 h-8", number: "text-5xl", text: "text-base" },
};

export function StreakCounter({ 
  currentStreak, 
  bestStreak, 
  streakType = "sales",
  size = "md" 
}: StreakCounterProps) {
  const config = streakConfig[streakType];
  const sizes = sizeConfig[size];
  const Icon = config.icon;
  const isOnFire = currentStreak >= 3;
  const isRecord = currentStreak >= bestStreak && currentStreak > 0;

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={cn(
        "relative overflow-hidden rounded-card border border-card-border bg-card shadow-relevo",
        sizes.container,
        isOnFire && "border-warning/40 bg-warning/[0.06]"
      )}
    >
      {/* Background flames animation */}
      {isOnFire && (
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ y: 100, opacity: 0 }}
              animate={{ 
                y: [-20, -60, -20],
                opacity: [0.1, 0.3, 0.1],
              }}
              transition={{
                duration: 2 + i * 0.5,
                repeat: Infinity,
                delay: i * 0.3,
              }}
              className="absolute bottom-0"
              style={{ left: `${15 + i * 18}%` }}
            >
              <Flame className="w-8 h-8 text-warning/20" />
            </motion.div>
          ))}
        </div>
      )}

      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Streak Icon */}
          <motion.div
            animate={isOnFire ? { scale: [1, 1.1, 1] } : {}}
            transition={{ duration: 0.5, repeat: isOnFire ? Infinity : 0 }}
            className={cn(
              "rounded-xl flex items-center justify-center",
              sizes.container,
              isOnFire 
                ? "bg-warning text-warning-foreground" 
                : "bg-muted text-muted-foreground"
            )}
          >
            <Flame className={sizes.icon} />
          </motion.div>

          {/* Streak Info */}
          <div>
            <div className="flex items-baseline gap-1">
              <motion.span
                key={currentStreak}
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={cn(sizes.number, "font-extrabold tabular-nums tracking-[-0.04em]", isOnFire ? "text-warning-strong" : "text-foreground")}
              >
                {currentStreak}
              </motion.span>
              <span className={cn(sizes.text, "text-muted-foreground")}>dias</span>
            </div>
            <p className={cn(sizes.text, "text-muted-foreground flex items-center gap-1")}>
              <Icon className="w-3 h-3" />
              Sequência de {config.label.toLowerCase()}
            </p>
          </div>
        </div>

        {/* Best Streak */}
        <div className="text-right">
          <p className={cn(sizes.text, "text-muted-foreground")}>Melhor</p>
          <p className={cn(sizes.text, "font-bold tabular-nums flex items-center gap-1 justify-end")}>
            {isRecord && <Zap className="w-3 h-3 text-primary-soft-foreground" />}
            {bestStreak} dias
          </p>
        </div>
      </div>

      {/* Fire badge for streaks */}
      {currentStreak >= 7 && (
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          className="absolute -top-2 -right-2 inline-flex items-center gap-1 rounded-full bg-warning px-2 py-1 text-xs font-bold text-warning-foreground shadow-relevo"
        >
          <Flame className="h-3 w-3" aria-hidden />
          Em chamas!
        </motion.div>
      )}
    </motion.div>
  );
}
