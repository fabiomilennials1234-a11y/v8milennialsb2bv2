import { memo } from "react";
import { motion } from "framer-motion";
import { Trophy, Flame, Crown, Medal, Award } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";

interface RankedUser {
  id: string;
  name: string;
  value: number;
  position: number;
  avatarUrl?: string;
  goalProgress: number;
}

interface Prize {
  position: number;
  prize_name: string;
  prize_icon: string;
  prize_value?: number | null;
}

interface TVCompetitionBlockProps {
  competitionName: string | null;
  users: RankedUser[];
  prizes: Prize[];
  metricType: "sales" | "meetings";
}

const POSITION_ICONS = [Crown, Medal, Award];
const POSITION_COLORS = ["text-yellow-400", "text-slate-300", "text-amber-500"];
const POSITION_BORDERS = ["border-yellow-400", "border-slate-300", "border-amber-500"];
const POSITION_GLOWS = [
  "shadow-[0_0_20px_rgba(250,204,21,0.3)]",
  "shadow-[0_0_12px_rgba(148,163,184,0.2)]",
  "shadow-[0_0_12px_rgba(180,83,9,0.2)]",
];

const fmt = (v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}K` : `R$ ${v}`;

function TVCompetitionBlockBase({ competitionName, users, prizes, metricType }: TVCompetitionBlockProps) {
  const top3 = users.slice(0, 3);
  const rest = users.slice(3, 8); // Max 5 more for TV
  const prizeMap = new Map(prizes.map((p) => [p.position, p]));

  // Reorder for podium: [2nd, 1st, 3rd]
  const podiumOrder = top3.length >= 3
    ? [top3[1], top3[0], top3[2]]
    : top3;
  const podiumHeights = ["h-28", "h-36", "h-24"];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-yellow-400" />
          <h2 className="text-xl font-bold tracking-tight">
            {competitionName || "Ranking de Vendas"}
          </h2>
        </div>
        <motion.div
          className="flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/20 border border-red-500/30"
          animate={{ opacity: [1, 0.5, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Ao Vivo</span>
        </motion.div>
      </div>

      {/* Podium Top 3 */}
      {top3.length > 0 && (
        <div className="flex items-end justify-center gap-4">
          {podiumOrder.map((user, visualIdx) => {
            if (!user) return null;
            const posIdx = user.position - 1;
            const Icon = POSITION_ICONS[posIdx] || Trophy;
            const prize = prizeMap.get(user.position);
            const isFirst = user.position === 1;

            return (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: visualIdx * 0.15, type: "spring", stiffness: 150 }}
                className={`flex flex-col items-center ${podiumHeights[visualIdx]} justify-end`}
              >
                {/* Glow for 1st */}
                {isFirst && (
                  <motion.div
                    className="absolute -inset-2 rounded-2xl bg-yellow-400/10 blur-xl"
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  />
                )}

                <div className={`relative flex flex-col items-center p-4 rounded-xl border-2 ${POSITION_BORDERS[posIdx]} ${POSITION_GLOWS[posIdx]} bg-card/50 backdrop-blur-sm`}>
                  {/* Position icon */}
                  <Icon className={`w-5 h-5 ${POSITION_COLORS[posIdx]} mb-2`} />

                  {/* Avatar */}
                  <div className={`border-2 ${POSITION_BORDERS[posIdx]} rounded-full`}>
                    <UserAvatar
                      name={user.name}
                      avatarUrl={user.avatarUrl}
                      size="lg"
                      fallbackClassName="bg-card text-foreground"
                    />
                  </div>

                  {/* Name + Value */}
                  <p className="font-bold text-base mt-2 truncate max-w-[120px]">
                    {user.name.split(" ")[0]}
                  </p>
                  <p className="text-lg font-bold text-primary">
                    {metricType === "sales" ? fmt(user.value) : `${user.value} reuniões`}
                  </p>

                  {/* Goal progress */}
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-sm font-bold ${user.goalProgress >= 100 ? "text-success" : user.goalProgress >= 80 ? "text-yellow-400" : "text-muted-foreground"}`}>
                      {user.goalProgress}%
                    </span>
                    {user.goalProgress >= 80 && (
                      <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
                        <Flame className="w-4 h-4 text-orange-400" />
                      </motion.div>
                    )}
                  </div>

                  {/* Prize */}
                  {prize && (
                    <div className={`mt-2 px-3 py-1.5 rounded-lg text-center ${user.goalProgress >= 100 ? "bg-success/20 border border-success/30" : "bg-muted/50 border border-border/30 opacity-60"}`}>
                      <span className="text-sm">{prize.prize_icon}</span>
                      <p className="text-[10px] font-semibold truncate max-w-[90px]">{prize.prize_name}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Rest of ranking (4th+) */}
      {rest.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {rest.map((user, i) => (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.08 }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-card/30 border border-border/20"
            >
              <span className="text-lg font-bold text-muted-foreground w-8">{user.position}º</span>
              <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="sm" fallbackClassName="bg-muted text-muted-foreground" />
              <span className="flex-1 font-medium truncate">{user.name}</span>
              <span className="font-bold text-primary">
                {metricType === "sales" ? fmt(user.value) : `${user.value}`}
              </span>
              <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(user.goalProgress, 100)}%` }}
                  transition={{ duration: 0.6, delay: 0.6 + i * 0.08 }}
                  className={`h-full rounded-full ${user.goalProgress >= 80 ? "bg-success" : user.goalProgress >= 40 ? "bg-primary" : "bg-destructive"}`}
                />
              </div>
              <span className="text-sm font-bold w-10 text-right">{user.goalProgress}%</span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export const TVCompetitionBlock = memo(TVCompetitionBlockBase);
