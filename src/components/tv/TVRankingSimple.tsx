import { motion } from "framer-motion";
import { Trophy } from "lucide-react";

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

// Avatar background gradient by podium position (1º gold, 2º blue, 3º violet).
const AVATAR_GRAD = [
  "linear-gradient(135deg,#ed9326,#ffd400)",
  "linear-gradient(135deg,#3b82f6,#1d4ed8)",
  "linear-gradient(135deg,#a855f7,#7c3aed)",
];
const PEDESTAL_BG = [
  "linear-gradient(180deg,rgba(237,147,38,0.25),rgba(237,147,38,0.05))",
  "linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))",
  "linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.015))",
];
const PEDESTAL_H = ["h-9", "h-6", "h-4"];
const POS_LABEL = ["1º", "2º", "3º"];

/** Live wall ranking shown as a podium (matches the mockup's "Corrida"). */
export function TVRankingSimple({ users, metricType = "sales" }: TVRankingSimpleProps) {
  const top = users.slice(0, 3);
  if (top.length === 0) return null;

  // Classic podium order: 2nd | 1st | 3rd (centred on the leader).
  const order =
    top.length >= 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : [top[0]];
  const posIdx = top.length >= 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : [0];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5 font-display text-[11px] font-bold text-[#f8f5e7] uppercase leading-tight">
          <Trophy className="w-3.5 h-3.5 text-[#ffd400]" />
          Ranking<br />de vendas
        </div>
        <span className="tv-live-badge flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase">
          <span className="tv-live-dot" />
          LIVE
        </span>
      </div>
      <div className="text-[8.5px] text-[#8a857a] mt-1">{users.length} participantes</div>

      {/* Podium */}
      <div className="flex-1 flex items-end justify-center gap-2 mt-3">
        {order.map((user, vi) => {
          if (!user) return null;
          const pi = posIdx[vi]; // 0 = 1st, 1 = 2nd, 2 = 3rd
          const isFirst = pi === 0;
          const avatarPx = isFirst ? 40 : 32;

          return (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: vi * 0.12, type: "spring", stiffness: 160, damping: 18 }}
              className="flex flex-col items-center"
            >
              {isFirst ? (
                <Trophy className="w-3.5 h-3.5 text-[#ffd400] mb-0.5" />
              ) : (
                <span className="text-[8px] font-bold text-[#f8f5e7]/60 mb-0.5">{POS_LABEL[pi]}</span>
              )}

              {/* Avatar */}
              <div
                className="rounded-full flex items-center justify-center font-semibold text-[#1c1c1c] overflow-hidden shrink-0"
                style={{
                  width: avatarPx,
                  height: avatarPx,
                  background: AVATAR_GRAD[pi],
                  border: "2px solid #131110",
                  fontSize: isFirst ? 13 : 11,
                  boxShadow: isFirst ? "0 0 16px rgba(237,147,38,0.4)" : undefined,
                }}
              >
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  user.name.charAt(0)
                )}
              </div>

              {/* Name */}
              <div
                className={`text-[9.5px] ${isFirst ? "font-semibold" : "font-medium"} text-[#f8f5e7] mt-1 truncate max-w-[80px] text-center`}
              >
                {user.name.split(" ")[0]}
              </div>

              {/* Value */}
              <div
                className={`font-display ${isFirst ? "text-base" : "text-sm"} font-bold tabular-nums ${isFirst ? "text-[#ffd400]" : "text-[#f8f5e7]"}`}
              >
                {formatValue(user.value, metricType)}
              </div>

              {/* Pedestal */}
              <div className={`w-10 ${PEDESTAL_H[pi]} rounded-t-md mt-1`} style={{ background: PEDESTAL_BG[pi] }} />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
