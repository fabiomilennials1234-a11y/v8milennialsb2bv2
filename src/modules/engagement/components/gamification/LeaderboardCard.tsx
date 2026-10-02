import { motion } from "framer-motion";
import { Trophy, Medal, Award, Crown, Flame, TrendingUp } from "lucide-react";
import { MiniProgressRing } from "./ProgressRing";
import { UserAvatar } from "@/components/ui/user-avatar";

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

/**
 * Pódio no vocabulário V5: ouro = `primary`, prata = `silver`, bronze =
 * `warning`. `gradient` é o preenchimento sólido do selo de posição (o nome
 * ficou do degradê antigo); `bg`/`border` tingem o cartão; `ring` é a borda do
 * avatar no pódio.
 */
const positionConfig = {
  1: { 
    icon: Crown, 
    gradient: "bg-primary text-primary-foreground",
    bg: "bg-primary-soft/60",
    border: "border-primary/40",
    shadow: "shadow-brilho-ouro",
    ring: "border-primary",
    fallback: "bg-primary-soft text-primary-soft-foreground",
  },
  2: { 
    icon: Medal, 
    gradient: "bg-silver text-silver-foreground",
    bg: "bg-silver/10",
    border: "border-silver/40",
    shadow: "shadow-relevo",
    ring: "border-silver",
    fallback: "bg-silver/15 text-foreground",
  },
  3: { 
    icon: Award, 
    gradient: "bg-warning text-warning-foreground",
    bg: "bg-warning/10",
    border: "border-warning/40",
    shadow: "shadow-relevo",
    ring: "border-warning",
    fallback: "bg-warning/15 text-warning-strong",
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
      className={`relative overflow-hidden rounded-2xl border p-4 transition-all ${
        isTop3 
          ? `${config.bg} ${config.border} ${config.shadow}` 
          : "bg-card border-card-border shadow-relevo hover:border-primary/30"
      }`}
    >
      {/* Shimmer effect for top 3 */}
      {isTop3 && (
        <motion.div
          className="absolute inset-0 -translate-x-full"
          animate={{ translateX: ["100%", "-100%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
          style={{
            background: "linear-gradient(90deg, transparent, hsl(var(--card) / 0.35), transparent)",
          }}
        />
      )}

      <div className="relative flex items-center gap-4">
        {/* Position */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          isTop3 ? config.gradient : "bg-muted"
        }`}>
          {isTop3 ? (
            <Icon className="w-5 h-5" />
          ) : (
            <span className="text-lg font-extrabold tabular-nums text-muted-foreground">{user.position}</span>
          )}
        </div>

        {/* Avatar */}
        <UserAvatar
          name={user.name}
          avatarUrl={user.avatarUrl}
          size="lg"
          fallbackClassName={isTop3 ? config.fallback : "bg-muted text-foreground"}
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold tracking-[-0.01em] truncate">{user.name}</h3>
            {user.streak && user.streak >= 3 && (
              <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-warning/15 rounded-full">
                <Flame className="w-3 h-3 text-warning-strong" />
                <span className="text-xs font-bold tabular-nums text-warning-strong">{user.streak}</span>
              </div>
            )}
            {user.trend === "up" && (
              <TrendingUp className="w-4 h-4 text-success" />
            )}
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
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
              className="mb-3"
            >
              <UserAvatar
                name={user.name}
                avatarUrl={user.avatarUrl}
                size="xl"
                className={`border-4 ${config.ring}`}
                fallbackClassName={config.fallback}
              />
            </motion.div>

            {/* Name */}
            <p className="text-sm font-bold text-center mb-2 max-w-[100px] truncate">
              {user.name.split(" ")[0]}
            </p>

            {/* Podium */}
            <div
              className={`${heights[index]} w-24 rounded-t-2xl flex flex-col items-center justify-start pt-3 ${config.gradient}`}
            >
              <Icon className="w-6 h-6 mb-1" />
              <span className="text-xl font-extrabold tabular-nums tracking-[-0.03em]">{actualPosition}º</span>
              <p className="text-xs opacity-80 mt-1 tabular-nums">
                R$ {(user.value / 1000).toFixed(0)}K
              </p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
