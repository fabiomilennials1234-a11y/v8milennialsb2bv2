import { memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Medal, Award } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TVRankingUser {
  id: string;
  name: string;
  value: number;
  goalProgress: number;
  position: number;
  avatarUrl?: string;
}

interface TVPrize {
  position: number;
  prize_name: string;
  prize_icon: string;
  prize_value: number | null;
}

interface TVCompetitionBlockV2Props {
  competitionName: string;
  daysLeft: number;
  users: TVRankingUser[];
  prizes: TVPrize[];
  metricType?: "sales" | "meetings";
  participantCount?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const firstName = (name: string) => name.split(" ")[0];

function formatValue(value: number, metricType: string) {
  if (metricType === "meetings") return `${value}`;
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
  return `R$ ${value}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POSITION_ICONS = [Crown, Medal, Award];

const PODIUM_COLORS = {
  border: ["border-yellow-400", "border-slate-300", "border-amber-600"],
  text: ["text-yellow-400", "text-slate-300", "text-amber-500"],
  glow: [
    "shadow-[0_0_18px_rgba(250,204,21,0.35)]",
    "shadow-[0_0_10px_rgba(148,163,184,0.2)]",
    "shadow-[0_0_10px_rgba(180,83,9,0.2)]",
  ],
  pedestalBg: [
    "bg-gradient-to-t from-yellow-500/30 to-yellow-500/5",
    "bg-gradient-to-t from-slate-400/20 to-slate-400/5",
    "bg-gradient-to-t from-amber-700/20 to-amber-700/5",
  ],
} as const;

const AVATAR_SIZES: Array<"xl" | "lg" | "lg"> = ["xl", "lg", "lg"];
const AVATAR_PX = [64, 52, 48];
const PEDESTAL_HEIGHTS = ["h-[68px]", "h-[52px]", "h-[40px]"];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Pulsing green LIVE badge */
function LiveBadge({ daysLeft }: { daysLeft: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30">
        <motion.div
          className="w-2 h-2 rounded-full bg-emerald-500"
          animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
        />
        <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
          Live
        </span>
      </div>
      <span className="text-xs text-muted-foreground font-medium">
        {daysLeft}d restantes
      </span>
    </div>
  );
}

/** Single podium card */
function PodiumCard({
  user,
  posIdx,
  prize,
  metricType,
  visualIdx,
}: {
  user: TVRankingUser;
  posIdx: number; // 0-based position index
  prize: TVPrize | undefined;
  metricType: string;
  visualIdx: number;
}) {
  const Icon = POSITION_ICONS[posIdx] || Crown;
  const isFirst = posIdx === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: visualIdx * 0.12, type: "spring", stiffness: 160, damping: 18 }}
      className="flex flex-col items-center relative"
    >
      {/* Radial glow behind 1st */}
      {isFirst && (
        <motion.div
          className="absolute -inset-4 rounded-2xl bg-yellow-400/10 blur-2xl pointer-events-none"
          animate={{ opacity: [0.25, 0.5, 0.25] }}
          transition={{ repeat: Infinity, duration: 2.5 }}
        />
      )}

      {/* Icon */}
      <Icon className={`w-4 h-4 ${PODIUM_COLORS.text[posIdx]} mb-1 relative z-10`} />

      {/* Avatar */}
      <div
        className={`relative z-10 border-2 ${PODIUM_COLORS.border[posIdx]} rounded-full ${PODIUM_COLORS.glow[posIdx]}`}
        style={{ width: AVATAR_PX[posIdx], height: AVATAR_PX[posIdx] }}
      >
        <UserAvatar
          name={user.name}
          avatarUrl={user.avatarUrl}
          size={AVATAR_SIZES[posIdx]}
          className="w-full h-full"
          fallbackClassName="bg-card text-foreground"
        />
      </div>

      {/* Name */}
      <p className="font-bold text-sm mt-1.5 truncate max-w-[90px] relative z-10">
        {firstName(user.name)}
      </p>

      {/* Value */}
      <motion.p
        key={user.value}
        initial={{ opacity: 0.6, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className={`text-sm font-bold ${isFirst ? "text-yellow-400" : "text-primary"} relative z-10`}
      >
        {formatValue(user.value, metricType)}
      </motion.p>

      {/* Pedestal with prize */}
      <div
        className={`mt-1.5 w-full min-w-[80px] ${PEDESTAL_HEIGHTS[posIdx]} rounded-t-lg ${PODIUM_COLORS.pedestalBg[posIdx]} border-t ${PODIUM_COLORS.border[posIdx]} border-opacity-40 flex flex-col items-center justify-center px-2 relative z-10`}
      >
        {prize ? (
          <>
            <span className="text-base leading-none">{prize.prize_icon}</span>
            <p className="text-[9px] font-semibold truncate max-w-[72px] text-center mt-0.5 text-muted-foreground">
              {prize.prize_name}
            </p>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">&mdash;</span>
        )}
      </div>
    </motion.div>
  );
}

/** Single row in the 4+ ranking list */
function RankingRow({
  user,
  metricType,
  index,
}: {
  user: TVRankingUser;
  metricType: string;
  index: number;
}) {
  const barWidth = Math.min(user.goalProgress, 100);
  const barColor =
    user.goalProgress >= 80
      ? "bg-emerald-500"
      : user.goalProgress >= 40
        ? "bg-primary"
        : "bg-destructive";

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.4 + index * 0.06 }}
      className="flex items-center gap-2 px-3 py-1 rounded-md"
      style={{ background: "rgba(13,13,24,0.6)" }}
    >
      {/* Position */}
      <span className="text-sm font-bold text-muted-foreground w-6 text-right shrink-0">
        {user.position}
        <span className="text-[10px]">o</span>
      </span>

      {/* Avatar */}
      <UserAvatar
        name={user.name}
        avatarUrl={user.avatarUrl}
        size="xs"
        className="w-7 h-7 shrink-0"
        fallbackClassName="bg-muted text-muted-foreground text-[9px]"
      />

      {/* Name */}
      <span className="flex-1 text-xs font-medium truncate">
        {firstName(user.name)}
      </span>

      {/* Value */}
      <motion.span
        key={user.value}
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 1 }}
        className="text-xs font-bold text-primary shrink-0"
      >
        {formatValue(user.value, metricType)}
      </motion.span>

      {/* Micro progress bar */}
      <div className="w-[60px] h-[3px] bg-muted/40 rounded-full overflow-hidden shrink-0">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${barWidth}%` }}
          transition={{ duration: 0.5, delay: 0.5 + index * 0.06 }}
          className={`h-full rounded-full ${barColor}`}
        />
      </div>

      {/* Percentage */}
      <span className="text-[10px] font-bold w-8 text-right text-muted-foreground shrink-0">
        {user.goalProgress}%
      </span>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function TVCompetitionBlockV2Base({
  competitionName,
  daysLeft,
  users,
  prizes,
  metricType = "sales",
  participantCount,
}: TVCompetitionBlockV2Props) {
  // Edge case: no users -> don't render
  if (!users || users.length === 0) return null;

  const top3 = users.slice(0, 3);
  const rest = users.slice(3, 10);
  const prizeMap = new Map(prizes.map((p) => [p.position, p]));

  // Classic podium order: 2nd | 1st | 3rd (only when 3+ users)
  const podiumOrder =
    top3.length >= 3
      ? [top3[1], top3[0], top3[2]]
      : top3.length === 2
        ? [top3[1], top3[0]]
        : [top3[0]];

  // Map visual index to position index for styling
  const positionIndices =
    top3.length >= 3
      ? [1, 0, 2]
      : top3.length === 2
        ? [1, 0]
        : [0];

  return (
    <div className="space-y-3">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between pb-2 border-b border-border/20">
        <div className="flex items-center gap-2">
          <span className="text-base">🏆</span>
          <h2
            className="text-[16px] font-bold uppercase tracking-wide"
            style={{
              background: "linear-gradient(135deg, #fbbf24, #f59e0b, #d97706)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {competitionName || "Ranking de Vendas"}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {participantCount != null && (
            <span className="text-[10px] text-muted-foreground">
              {participantCount} participantes
            </span>
          )}
          <LiveBadge daysLeft={daysLeft} />
        </div>
      </div>

      {/* ---- Podium ---- */}
      <div className="flex items-end justify-center gap-5 pt-2 pb-1">
        <AnimatePresence mode="wait">
          {podiumOrder.map((user, visualIdx) => {
            if (!user) return null;
            const posIdx = positionIndices[visualIdx];
            return (
              <PodiumCard
                key={user.id}
                user={user}
                posIdx={posIdx}
                prize={prizeMap.get(user.position)}
                metricType={metricType}
                visualIdx={visualIdx}
              />
            );
          })}
        </AnimatePresence>
      </div>

      {/* ---- Ranking list (4+) ---- */}
      {rest.length > 0 && (
        <div className="flex flex-col gap-1">
          {rest.map((user, i) => (
            <RankingRow
              key={user.id}
              user={user}
              metricType={metricType}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const TVCompetitionBlockV2 = memo(TVCompetitionBlockV2Base);
