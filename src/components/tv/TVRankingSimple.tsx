import { motion } from "framer-motion";
import { Trophy, Crown, Medal, Award } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";

interface RankingUser {
  id: string;
  name: string;
  value: number;
  goalProgress: number;
  position: number;
  avatarUrl?: string;
}

interface TVRankingSimpleProps {
  users: RankingUser[];
  metricType?: "sales" | "meetings";
}

function formatValue(value: number, metricType: string) {
  if (metricType === "meetings") return `${value}`;
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
  return `R$ ${value}`;
}

const POSITION_ICONS = [Crown, Medal, Award];
const POSITION_COLORS = ["text-yellow-400", "text-slate-400", "text-amber-600"];
const POSITION_BG = ["bg-yellow-400/10", "bg-slate-400/10", "bg-amber-600/10"];

export function TVRankingSimple({ users, metricType = "sales" }: TVRankingSimpleProps) {
  const top5 = users.slice(0, 5);
  if (top5.length === 0) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-400" />
          <span className="text-sm font-bold text-white uppercase tracking-wider">
            Ranking de Vendas
          </span>
        </div>
      </div>

      {/* Ranking list */}
      <div className="flex-1 space-y-2">
        {top5.map((user, i) => {
          const isTop3 = user.position <= 3;
          const Icon = isTop3 ? POSITION_ICONS[user.position - 1] : null;
          const posColor = isTop3 ? POSITION_COLORS[user.position - 1] : "text-white/40";
          const posBg = isTop3 ? POSITION_BG[user.position - 1] : "";

          return (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`flex items-center gap-3 p-2.5 rounded-lg ${
                isTop3 ? "bg-white/[0.04] border border-white/[0.06]" : "bg-white/[0.02]"
              }`}
            >
              {/* Position */}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${posBg}`}>
                {Icon ? (
                  <Icon className={`w-4 h-4 ${posColor}`} />
                ) : (
                  <span className="text-sm font-extrabold text-white/40">{user.position}</span>
                )}
              </div>

              {/* Avatar */}
              <UserAvatar
                name={user.name}
                avatarUrl={user.avatarUrl}
                size="sm"
                fallbackClassName="bg-white/10 text-white/60"
              />

              {/* Name */}
              <span className="flex-1 text-sm font-semibold text-white truncate">
                {user.name.split(" ")[0]}
              </span>

              {/* Value */}
              <span className={`text-sm font-extrabold ${isTop3 ? "text-primary" : "text-white/60"}`}>
                {formatValue(user.value, metricType)}
              </span>

              {/* Goal bar (mini) */}
              <div className="w-14">
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      user.goalProgress >= 100 ? "bg-emerald-400" :
                      user.goalProgress >= 80 ? "bg-orange-400" :
                      "bg-blue-400"
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(user.goalProgress, 100)}%` }}
                    transition={{ duration: 0.8, delay: i * 0.1 }}
                  />
                </div>
                <p className="text-[9px] text-white/40 text-right mt-0.5">
                  {user.goalProgress}%
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
