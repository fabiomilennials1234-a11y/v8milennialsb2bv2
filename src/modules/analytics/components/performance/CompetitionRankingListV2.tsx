import { memo, useEffect, useRef, useState } from "react";
import { motion, useAnimation, LayoutGroup } from "framer-motion";
import { ArrowDown, ArrowUp, Flame, ListOrdered } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { IconChip } from "@/components/ui/bento";

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

// Mesmas faixas do pódio, em token: bateu / perto / meio / longe.
function getProgressColor(progress: number) {
  if (progress >= 100) return { bar: "bg-success", text: "text-success" };
  if (progress >= 80) return { bar: "bg-warning", text: "text-warning-strong" };
  if (progress >= 50) return { bar: "bg-insights", text: "text-insights" };
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
      className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-muted/50"
    >
      {/* Position */}
      <span
        className="w-6 shrink-0 text-center text-sm font-extrabold tabular-nums text-muted-foreground"
      >
        {user.position}
      </span>

      {/* Change badge */}
      {change && change.delta !== 0 && (
        <motion.span
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1 + index * 0.1, type: "spring" }}
          className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
            change.delta < 0
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          }`}
          aria-label={change.delta < 0 ? `Subiu ${Math.abs(change.delta)}` : `Caiu ${change.delta}`}
        >
          {change.delta < 0 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
          {Math.abs(change.delta)}
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
      <span className="max-w-[140px] shrink-0 truncate text-sm font-semibold">
        {user.name}
      </span>

      {/* Value */}
      <span
        className="min-w-[60px] shrink-0 text-right text-sm font-extrabold tabular-nums tracking-[-0.02em] text-foreground"
      >
        {formattedValue}
      </span>

      {/* Progress bar */}
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-muted">
        <motion.div
          initial={{ width: 0 }}
          animate={controls}
          transition={{ duration: 0.7, delay: 0.15 + index * 0.05, ease: "easeOut" }}
          className={`h-full rounded-full ${bar}`}
        />
      </div>

      {/* Progress text */}
      <span
        className={`inline-flex min-w-[46px] shrink-0 items-center justify-end gap-0.5 text-[11px] font-bold tabular-nums ${text}`}
      >
        {user.goalProgress >= 80 && <Flame className="h-3 w-3" aria-hidden />}
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
    <section className="rounded-card border border-card-border bg-card p-2 text-card-foreground shadow-relevo">
      {/* Section header */}
      <header className="flex items-center gap-2 px-3 pb-2 pt-2.5">
        <IconChip icon={ListOrdered} />
        <h3 className="text-[15px] font-bold tracking-[-0.02em]">
          Ranking Completo
        </h3>
      </header>

      {/* List */}
      <LayoutGroup>
        <div className="space-y-0.5">
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
    </section>
  );
}

export const CompetitionRankingListV2 = memo(CompetitionRankingListV2Base);
