import { memo } from "react";
import { motion } from "framer-motion";
import { Crown, Medal, Award, Flame, Star, Lock, Check } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";

interface PodiumUser {
  id: string;
  name: string;
  value: number;
  position: number;
  avatarUrl?: string;
  goalProgress: number;
}

interface PodiumPrize {
  position: number;
  prize_name: string;
  prize_icon: string;
  prize_value?: number | null;
}

interface CompetitionPodiumProps {
  users: PodiumUser[];
  prizes: PodiumPrize[];
  criteria: "absolute_value" | "goal_percentage";
  metricType: "sales" | "meetings";
}

const POSITION_ICONS = [Crown, Medal, Award];
const POSITION_COLORS = ["text-yellow-400", "text-slate-300", "text-amber-500"];
const POSITION_BORDERS = ["border-yellow-400/60", "border-slate-300/40", "border-amber-600/40"];
const POSITION_BG = [
  "bg-gradient-to-b from-yellow-400/10 to-yellow-400/5",
  "bg-gradient-to-b from-slate-300/8 to-slate-300/3",
  "bg-gradient-to-b from-amber-600/8 to-amber-600/3",
];

const fmt = (v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}K` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

function CompetitionPodiumBase({ users, prizes, criteria, metricType }: CompetitionPodiumProps) {
  const top3 = users.slice(0, 3);
  const prizeMap = new Map(prizes.map((p) => [p.position, p]));

  // Podium order: 2nd, 1st, 3rd
  const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;
  const podiumSizes = ["w-[150px]", "w-[170px]", "w-[140px]"];
  const podiumMarginTop = ["mt-8", "mt-0", "mt-12"];
  const avatarSizes: Array<"lg" | "xl"> = ["lg", "xl", "lg"];

  return (
    <div className="flex items-end justify-center gap-4 py-6">
      {podiumOrder.map((user, visualIdx) => {
        if (!user) return null;
        const posIdx = user.position - 1;
        const Icon = POSITION_ICONS[posIdx] || Award;
        const prize = prizeMap.get(user.position);
        const isFirst = user.position === 1;
        const unlocked = user.goalProgress >= 100;

        // SVG progress ring
        const ringR = 24;
        const circumference = 2 * Math.PI * ringR;
        const offset = circumference - (Math.min(user.goalProgress, 100) / 100) * circumference;

        return (
          <motion.div
            key={user.id}
            initial={isFirst ? { opacity: 0, scale: 0.8 } : { opacity: 0, x: visualIdx === 0 ? -40 : 40 }}
            animate={isFirst ? { opacity: 1, scale: 1 } : { opacity: 1, x: 0 }}
            transition={isFirst
              ? { delay: 0.3, type: "spring", stiffness: 200, damping: 15 }
              : { delay: visualIdx === 0 ? 0.1 : 0.2, duration: 0.5 }
            }
            className={`flex flex-col items-center ${podiumSizes[visualIdx]} ${podiumMarginTop[visualIdx]}`}
          >
            {/* Card */}
            <div className={`relative w-full rounded-2xl border ${POSITION_BORDERS[posIdx]} ${POSITION_BG[posIdx]} p-4 flex flex-col items-center`}>
              {/* Glow for 1st */}
              {isFirst && (
                <motion.div
                  className="absolute -inset-1 rounded-2xl"
                  animate={{ boxShadow: ["0 0 15px rgba(250,204,21,0.2)", "0 0 30px rgba(250,204,21,0.4)", "0 0 15px rgba(250,204,21,0.2)"] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                />
              )}

              {/* Shimmer effect for top 3 */}
              <div className="absolute inset-0 rounded-2xl overflow-hidden">
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ repeat: Infinity, duration: 3, delay: posIdx * 0.5 }}
                />
              </div>

              <div className="relative flex flex-col items-center">
                {/* Position icon */}
                <Icon className={`w-5 h-5 ${POSITION_COLORS[posIdx]} mb-2`} />

                {/* Avatar */}
                <div className={`border-2 ${POSITION_BORDERS[posIdx]} rounded-full`}>
                  <UserAvatar
                    name={user.name}
                    avatarUrl={user.avatarUrl}
                    size={avatarSizes[visualIdx]}
                    fallbackClassName="bg-card text-foreground font-bold"
                  />
                </div>

                {/* Name */}
                <p className="font-bold text-sm mt-2 truncate max-w-[120px]">
                  {user.name.split(" ")[0]}
                </p>

                {/* Value */}
                <p className="text-base font-bold text-primary mt-0.5">
                  {metricType === "sales" ? fmt(user.value) : `${user.value} reuniões`}
                </p>

                {/* Progress ring */}
                <div className="relative w-14 h-14 mt-2">
                  <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
                    <circle cx={28} cy={28} r={ringR} fill="none" stroke="hsl(var(--muted))" strokeWidth={3} />
                    <motion.circle
                      cx={28} cy={28} r={ringR} fill="none"
                      stroke={user.goalProgress >= 100 ? "hsl(var(--success))" : user.goalProgress >= 80 ? "#eab308" : "hsl(var(--primary))"}
                      strokeWidth={3} strokeLinecap="round"
                      strokeDasharray={circumference}
                      initial={{ strokeDashoffset: circumference }}
                      animate={{ strokeDashoffset: offset }}
                      transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                    {user.goalProgress}%
                  </span>
                </div>

                {/* Status icons */}
                <div className="flex items-center gap-1 mt-1 h-5">
                  {user.goalProgress >= 100 && (
                    <motion.div animate={{ rotate: [0, 360] }} transition={{ repeat: Infinity, duration: 4, ease: "linear" }}>
                      <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                    </motion.div>
                  )}
                  {user.goalProgress >= 80 && user.goalProgress < 100 && (
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
                      <Flame className="w-4 h-4 text-orange-400" />
                    </motion.div>
                  )}
                </div>
              </div>
            </div>

            {/* Prize below card */}
            {prize && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + posIdx * 0.1 }}
                className={`mt-2 w-full rounded-xl p-3 text-center border ${
                  unlocked
                    ? "bg-success/10 border-success/30"
                    : "bg-muted/30 border-border/30 opacity-50"
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-lg">{prize.prize_icon}</span>
                  {unlocked ? (
                    <Check className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <Lock className="w-3 h-3 text-muted-foreground" />
                  )}
                </div>
                <p className="text-xs font-semibold mt-0.5 truncate">{prize.prize_name}</p>
                {prize.prize_value && (
                  <p className="text-[10px] text-muted-foreground">R$ {prize.prize_value.toLocaleString("pt-BR")}</p>
                )}
              </motion.div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

export const CompetitionPodium = memo(CompetitionPodiumBase);
