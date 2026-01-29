import { motion } from "framer-motion";
import { Trophy, Medal, Award, Crown, Flame, TrendingUp } from "lucide-react";
import { MiniProgressRing } from "./ProgressRing";

interface LeaderboardUser {
  id: string;
  name: string;
  value: number;
  position: number;
  avatarUrl?: string;
  goalProgress?: number;
  streak?: number;
  trend?: "up" | "down" | "same";
}

interface LeaderboardCardProps {
  user: LeaderboardUser;
  valueLabel?: string;
  valuePrefix?: string;
  showGoalProgress?: boolean;
}

const positionConfig = {
  1: { 
    icon: Crown, 
    gradient: "from-yellow-400 via-amber-500 to-orange-500",
    bg: "bg-gradient-to-br from-yellow-400/20 to-amber-500/10",
    border: "border-yellow-400/50",
    shadow: "shadow-yellow-400/20",
  },
  2: { 
    icon: Medal, 
    gradient: "from-slate-300 via-slate-400 to-slate-500",
    bg: "bg-gradient-to-br from-slate-300/20 to-slate-400/10",
    border: "border-slate-400/50",
    shadow: "shadow-slate-400/20",
  },
  3: { 
    icon: Award, 
    gradient: "from-amber-600 via-amber-700 to-orange-700",
    bg: "bg-gradient-to-br from-amber-600/20 to-amber-700/10",
    border: "border-amber-600/50",
    shadow: "shadow-amber-600/20",
  },
};

export function LeaderboardCard({
  user,
  valueLabel = "vendas",
  valuePrefix = "R$ ",
  showGoalProgress = true,
}: LeaderboardCardProps) {
  const isTop3 = user.position <= 3;
  const config = positionConfig[user.position as keyof typeof positionConfig];
  const Icon = config?.icon || Trophy;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: user.position * 0.05 }}
      whileHover={{ scale: 1.02, y: -2 }}
      className={`relative overflow-hidden rounded-xl border p-4 transition-all ${
        isTop3 
          ? `${config.bg} ${config.border} shadow-lg ${config.shadow}` 
          : "bg-card border-border hover:border-primary/30"
      }`}
    >
      {/* Shimmer effect for top 3 */}
      {isTop3 && (
        <motion.div
          className="absolute inset-0 -translate-x-full"
          animate={{ translateX: ["100%", "-100%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
          style={{
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)",
          }}
        />
      )}

      <div className="relative flex items-center gap-4">
        {/* Position */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          isTop3 ? `bg-gradient-to-br ${config.gradient}` : "bg-muted"
        }`}>
          {isTop3 ? (
            <Icon className="w-5 h-5 text-white" />
          ) : (
            <span className="text-lg font-bold text-muted-foreground">{user.position}</span>
          )}
        </div>

        {/* Avatar */}
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
          isTop3 ? "bg-white/20" : "bg-accent"
        }`}>
          <span className={`text-lg font-bold ${isTop3 ? "text-white" : "text-accent-foreground"}`}>
            {user.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold truncate">{user.name}</h3>
            {user.streak && user.streak >= 3 && (
              <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-orange-500/10 rounded-full">
                <Flame className="w-3 h-3 text-orange-500" />
                <span className="text-xs font-medium text-orange-500">{user.streak}</span>
              </div>
            )}
            {user.trend === "up" && (
              <TrendingUp className="w-4 h-4 text-success" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {valuePrefix}{user.value.toLocaleString("pt-BR")} em {valueLabel}
          </p>
        </div>

        {/* Goal Progress */}
        {showGoalProgress && user.goalProgress !== undefined && (
          <MiniProgressRing 
            progress={user.goalProgress} 
            color={user.goalProgress >= 100 ? "success" : "primary"}
          />
        )}
      </div>
    </motion.div>
  );
}

export function TopThreePodium({ 
  users 
}: { 
  users: LeaderboardUser[] 
}) {
  const ordered = [users[1], users[0], users[2]].filter(Boolean);
  const heights = ["h-24", "h-32", "h-20"];
  const podiumOrder = [1, 0, 2];

  if (users.length < 3) return null;

  return (
    <div className="flex items-end justify-center gap-4 py-8">
      {ordered.map((user, index) => {
        const actualPosition = podiumOrder[index] + 1;
        const config = positionConfig[actualPosition as keyof typeof positionConfig];
        const Icon = config?.icon || Trophy;

        return (
          <motion.div
            key={user.id}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.2 }}
            className="flex flex-col items-center"
          >
            {/* Avatar */}
            <motion.div
              whileHover={{ scale: 1.1, y: -5 }}
              className={`w-16 h-16 rounded-full flex items-center justify-center mb-3 border-4 ${
                actualPosition === 1 
                  ? "border-yellow-400 bg-yellow-400/20" 
                  : actualPosition === 2 
                  ? "border-slate-400 bg-slate-400/20" 
                  : "border-amber-600 bg-amber-600/20"
              }`}
            >
              <span className="text-xl font-bold">
                {user.name.split(" ").map(n => n[0]).join("")}
              </span>
            </motion.div>

            {/* Name */}
            <p className="text-sm font-semibold text-center mb-2 max-w-[100px] truncate">
              {user.name.split(" ")[0]}
            </p>

            {/* Podium */}
            <div
              className={`${heights[index]} w-24 rounded-t-xl flex flex-col items-center justify-start pt-3 bg-gradient-to-b ${config.gradient}`}
            >
              <Icon className="w-6 h-6 text-white mb-1" />
              <span className="text-xl font-bold text-white">{actualPosition}º</span>
              <p className="text-xs text-white/80 mt-1">
                R$ {(user.value / 1000).toFixed(0)}K
              </p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
