import { memo, useEffect, useRef, useState } from "react";
import { motion, useAnimation, LayoutGroup } from "framer-motion";
import { UserAvatar } from "@/components/ui/user-avatar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RankingUser {
  id: string;
  name: string;
  value: number;
  goalProgress: number;
  position: number;
  avatarUrl?: string;
}

interface RankingChange {
  id: string;
  delta: number;
  isNewLeader: boolean;
  isNew: boolean;
}

interface CompetitionRankingListV2Props {
  users: RankingUser[];
  metricType?: "sales" | "meetings";
  getChange?: (userId: string) => RankingChange | undefined;
  isAnimatingTransitions?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(value: number, metricType: string) {
  if (metricType === "meetings") return `${value}`;
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
  return `R$ ${value.toLocaleString("pt-BR")}`;
}

function getProgressColor(progress: number) {
  if (progress >= 100) return { bar: "bg-success", text: "text-success" };
  if (progress >= 80)
    return {
      bar: "bg-gradient-to-r from-orange-500 to-amber-400",
      text: "text-orange-400",
    };
  if (progress >= 50) return { bar: "bg-blue-500", text: "text-blue-400" };
  return { bar: "bg-destructive", text: "text-destructive" };
}

// ---------------------------------------------------------------------------
// Animated counter hook
// ---------------------------------------------------------------------------

function useAnimatedCounter(target: number, duration = 600) {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);

  useEffect(() => {
    if (prev.current === target) return;
    const start = prev.current;
    const diff = target - start;
    const startTime = performance.now();

    let raf: number;
    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // ease-out quad
      const eased = 1 - (1 - t) * (1 - t);
      setDisplay(Math.round(start + diff * eased));
      if (t < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    prev.current = target;

    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

interface RankingRowProps {
  user: RankingUser;
  index: number;
  metricType: string;
  change?: RankingChange;
}

function RankingRow({ user, index, metricType, change }: RankingRowProps) {
  const controls = useAnimation();
  const { bar, text } = getProgressColor(user.goalProgress);
  const animatedValue = useAnimatedCounter(user.value);
  const clampedProgress = Math.min(user.goalProgress, 100);

  useEffect(() => {
    controls.start({ width: `${clampedProgress}%` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedProgress]);

  const formattedValue = formatValue(animatedValue, metricType);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: "easeOut" }}
      className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted/50 border border-border/50"
    >
      {/* Position */}
      <span
        className="text-sm text-center shrink-0 font-extrabold text-muted-foreground/60 w-6"
      >
        {user.position}
      </span>

      {/* Change badge */}
      {change && change.delta !== 0 && (
        <motion.span
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1 + index * 0.1, type: "spring" }}
          className={`text-[10px] font-bold shrink-0 px-1.5 py-0.5 rounded-full ${
            change.delta < 0
              ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300"
              : "bg-red-500/20 text-red-600 dark:text-red-300"
          }`}
        >
          {change.delta < 0 ? `↑${Math.abs(change.delta)}` : `↓${change.delta}`}
        </motion.span>
      )}

      {/* Avatar */}
      <UserAvatar
        name={user.name}
        avatarUrl={user.avatarUrl}
        size="sm"
        fallbackClassName="bg-muted text-muted-foreground"
      />

      {/* Name */}
      <span
        className="truncate shrink-0"
        style={{ fontWeight: 600, fontSize: 14, maxWidth: 140 }}
      >
        {user.name}
      </span>

      {/* Value */}
      <span
        className="shrink-0 min-w-[60px] text-right text-sm font-extrabold text-primary"
      >
        {formattedValue}
      </span>

      {/* Progress bar */}
      <div className="flex-1 h-1 rounded-full overflow-hidden bg-white/5">
        <motion.div
          initial={{ width: 0 }}
          animate={controls}
          transition={{ duration: 0.7, delay: 0.15 + index * 0.05, ease: "easeOut" }}
          className={`h-full rounded-full ${bar}`}
        />
      </div>

      {/* Progress text */}
      <span
        className={`shrink-0 ${text}`}
        style={{ fontSize: 11, fontWeight: 600, minWidth: 46, textAlign: "right" }}
      >
        {user.goalProgress >= 80 && "\uD83D\uDD25 "}
        {user.goalProgress}%
        {user.goalProgress >= 100 && " \u2713"}
      </span>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function CompetitionRankingListV2Base({
  users,
  metricType = "sales",
  getChange,
}: CompetitionRankingListV2Props) {
  if (users.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Section header */}
      <h3
        className="uppercase tracking-wider mb-3 text-sm font-bold text-muted-foreground"
      >
        Ranking Completo
      </h3>

      {/* List */}
      <LayoutGroup>
        <div className="space-y-1.5">
          {users.map((user, i) => (
            <motion.div
              key={user.id}
              layoutId={`ranking-row-${user.id}`}
              layout
              transition={{ layout: { type: "spring", stiffness: 120, damping: 18 } }}
            >
              <RankingRow
                user={user}
                index={i}
                metricType={metricType}
                change={getChange?.(user.id)}
              />
            </motion.div>
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}

export const CompetitionRankingListV2 = memo(CompetitionRankingListV2Base);
