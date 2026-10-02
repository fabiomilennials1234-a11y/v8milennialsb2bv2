import { memo, useState, useEffect, useMemo } from "react";
import { motion, LayoutGroup, AnimatePresence } from "framer-motion";
import { ArrowDown, ArrowUp, Crown, Flame, Sparkles } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PodiumUser {
  id: string;
  name: string;
  value: number;
  goalProgress: number;
  position: number;
  avatarUrl?: string;
}

export interface PodiumPrize {
  position: number;
  prize_name: string;
  prize_icon: string;
  prize_value: number | null;
}

interface RankingChange {
  id: string;
  previousPosition: number;
  currentPosition: number;
  delta: number;
  isNewLeader: boolean;
  isNew: boolean;
}

interface CompetitionPodiumV2Props {
  users: PodiumUser[];
  prizes: PodiumPrize[];
  metricType?: "sales" | "meetings";
  getChange?: (userId: string) => RankingChange | undefined;
  isAnimatingTransitions?: boolean;
  /** Previous ranking entries for animated reorder (from useRankingTransitions) */
  previousRanking?: Array<{ id: string; position: number }> | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(value: number, metricType: string) {
  if (metricType === "meetings") return `${value} reuniões`;
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
  return `R$ ${value.toLocaleString("pt-BR")}`;
}

// Faixas de progresso da meta — estado, então token: bateu (success), perto
// (warning), meio do caminho (insights), longe (destructive).
function progressColor(progress: number): string {
  if (progress >= 100) return "bg-success";
  if (progress >= 80) return "bg-warning";
  if (progress >= 50) return "bg-insights";
  return "bg-destructive";
}

function progressTrackColor(progress: number): string {
  if (progress >= 100) return "bg-success/20";
  if (progress >= 80) return "bg-warning/20";
  if (progress >= 50) return "bg-insights/20";
  return "bg-destructive/20";
}

// ---------------------------------------------------------------------------
// Position config
// ---------------------------------------------------------------------------

// V5: ouro = `primary`, prata = `silver`, bronze = `warning`. Sem degradê cru
// (não tinha par no escuro). `ring` é o aro do avatar; `pedestal*` pinta o
// bloco do prêmio; `valueText` é o número abaixo do nome.
const POSITION_CONFIG = {
  1: {
    avatarSize: "2xl" as const,
    avatarClassName: "h-[88px] w-[88px]",
    ring: "bg-primary",
    shadowGlow: "shadow-brilho-ouro",
    pedestalHeight: "h-[110px]",
    pedestalFill: "bg-primary-soft",
    pedestalBorder: "border-primary/40",
    valueText: "text-primary-soft-foreground",
    badgeColor: "bg-primary text-primary-foreground",
    ringOffset: 3,
  },
  2: {
    avatarSize: "xl" as const,
    avatarClassName: "h-[72px] w-[72px]",
    ring: "bg-silver",
    shadowGlow: "shadow-relevo",
    pedestalHeight: "h-[80px]",
    pedestalFill: "bg-silver/15",
    pedestalBorder: "border-silver/40",
    valueText: "text-foreground",
    badgeColor: "bg-silver text-silver-foreground",
    ringOffset: 3,
  },
  3: {
    avatarSize: "xl" as const,
    avatarClassName: "h-[68px] w-[68px]",
    ring: "bg-warning",
    shadowGlow: "shadow-relevo",
    pedestalHeight: "h-[60px]",
    pedestalFill: "bg-warning/15",
    pedestalBorder: "border-warning/40",
    valueText: "text-warning-strong",
    badgeColor: "bg-warning text-warning-foreground",
    ringOffset: 3,
  },
} as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RadialGlow() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[10%] h-[320px] w-[320px] -translate-x-1/2 rounded-full bg-primary/10 blur-[100px]" />
      <div className="absolute left-1/2 top-[25%] h-[200px] w-[200px] -translate-x-1/2 rounded-full bg-primary/[0.06] blur-[80px]" />
    </div>
  );
}

function CrownBadge() {
  return (
    <motion.span
      className="block leading-none text-primary"
      animate={{ scale: [1, 1.06, 1], rotate: [0, 3, -3, 0] }}
      transition={{ repeat: Infinity, duration: 3, ease: [0.4, 0, 0.2, 1] }}
    >
      <Crown className="h-7 w-7 fill-primary/25" strokeWidth={2.2} aria-label="Líder" />
    </motion.span>
  );
}

function PositionBadge({ position }: { position: number }) {
  const cfg = POSITION_CONFIG[position as 1 | 2 | 3];
  return (
    <span
      className={cn(
        "absolute -top-2 -right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold tabular-nums shadow-relevo ring-2 ring-card",
        cfg?.badgeColor ?? "bg-muted text-foreground",
      )}
    >
      {position}
    </span>
  );
}

const TransitionBadge = memo(function TransitionBadge({ change }: { change: RankingChange | undefined }) {
  if (!change || (change.delta === 0 && !change.isNew && !change.isNewLeader)) return null;

  if (change.isNewLeader) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.5, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 1, type: "spring", stiffness: 300, damping: 15 }}
        className="mb-1 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[.06em] text-primary-soft-foreground"
      >
        <Crown className="h-3 w-3" aria-hidden />
        Novo líder
      </motion.div>
    );
  }

  if (change.isNew) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.2, type: "spring" }}
        className="mb-1 inline-flex items-center gap-1 rounded-full border border-insights/30 bg-insights/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[.06em] text-insights"
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        Novo
      </motion.div>
    );
  }

  const movedUp = change.delta < 0;
  const positions = Math.abs(change.delta);

  return (
    <motion.div
      initial={{ opacity: 0, y: movedUp ? 10 : -10, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 1, type: "spring", stiffness: 250, damping: 15 }}
      className={cn(
        "mb-1 inline-flex items-center gap-0.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold tabular-nums",
        movedUp
          ? "border-success/30 bg-success/10 text-success"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
      aria-label={movedUp ? `Subiu ${positions}` : `Caiu ${positions}`}
    >
      {movedUp ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
      {positions}
    </motion.div>
  );
});

function GoalProgressBar({
  progress,
  delay,
}: {
  progress: number;
  delay: number;
}) {
  const clampedWidth = Math.min(progress, 100);

  return (
    <div className="mt-2 w-full">
      <div
        className={cn(
          "relative h-[5px] w-full overflow-hidden rounded-full",
          progressTrackColor(progress),
        )}
      >
        <motion.div
          className={cn("absolute inset-y-0 left-0 rounded-full", progressColor(progress))}
          initial={{ width: "0%" }}
          animate={{ width: `${clampedWidth}%` }}
          transition={{ duration: 0.8, delay, ease: "easeOut" }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {progress}% da meta{progress >= 100 ? " \u2713" : ""}
        </span>
        {progress >= 100 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-success">
            <Flame className="h-3 w-3" aria-hidden />
            Meta batida
          </span>
        )}
        {progress >= 80 && progress < 100 && (
          <Flame className="h-3.5 w-3.5 text-warning-strong" aria-label="Perto da meta" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pedestal block
// ---------------------------------------------------------------------------

function Pedestal({
  prize,
  position,
}: {
  prize: PodiumPrize | undefined;
  position: 1 | 2 | 3;
}) {
  const cfg = POSITION_CONFIG[position];

  return (
    <div
      className={cn(
        cfg.pedestalHeight,
        "relative w-full overflow-hidden rounded-t-2xl border-x border-t",
        cfg.pedestalBorder,
        cfg.pedestalFill,
      )}
    >
      <div className="flex h-full flex-col items-center justify-center px-2 text-center">
        <span className="text-base leading-none">
          {prize ? prize.prize_icon : "\u2014"}
        </span>
        <p className="mt-1 max-w-full truncate text-[11px] font-bold text-foreground">
          {prize ? prize.prize_name : "\u2014"}
        </p>
        {prize?.prize_value != null ? (
          <p className="text-[10px] tabular-nums text-muted-foreground">
            R$ {prize.prize_value.toLocaleString("pt-BR")}
          </p>
        ) : prize ? (
          <p className="text-[10px] text-muted-foreground/60">&mdash;</p>
        ) : null}
      </div>

      {/* Shimmer */}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-card/40 to-transparent"
        animate={{ x: ["-100%", "200%"] }}
        transition={{
          repeat: Infinity,
          duration: 3.5,
          delay: position * 0.6,
          ease: "linear",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PodiumSlot (avatar + info + pedestal for one user)
// ---------------------------------------------------------------------------

function PodiumSlot({
  user,
  prize,
  metricType,
  animDelay,
  isFirst,
  change,
}: {
  user: PodiumUser;
  prize: PodiumPrize | undefined;
  metricType: string;
  animDelay: number;
  isFirst: boolean;
  change?: RankingChange;
}) {
  const pos = user.position as 1 | 2 | 3;
  const cfg = POSITION_CONFIG[pos];

  return (
    <motion.div
      className={cn(
        "flex flex-col items-center",
        isFirst ? "w-[170px] sm:w-[185px]" : "w-[145px] sm:w-[155px]",
        !isFirst && "mt-6",
      )}
      initial={
        isFirst
          ? { opacity: 0, scale: 0.8 }
          : { opacity: 0, y: 40 }
      }
      animate={
        isFirst
          ? { opacity: 1, scale: 1 }
          : { opacity: 1, y: 0 }
      }
      transition={
        isFirst
          ? { delay: animDelay, type: "spring", stiffness: 200, damping: 14 }
          : { delay: animDelay, type: "spring", stiffness: 160, damping: 18 }
      }
    >
      {/* Transition badge (↑2, NOVO LÍDER, etc.) */}
      <TransitionBadge change={change} />

      {/* Crown for 1st */}
      {isFirst && (
        <div className="mb-1">
          <CrownBadge />
        </div>
      )}

      {/* Avatar with gradient border */}
      <div className="relative">
        <PositionBadge position={pos} />
        <div
          className={cn(
            "rounded-full p-[3px]",
            cfg.ring,
            cfg.shadowGlow,
          )}
        >
          <div className="rounded-full bg-card p-[2px]">
            <UserAvatar
              name={user.name}
              avatarUrl={user.avatarUrl}
              size={cfg.avatarSize}
              className={cfg.avatarClassName}
              fallbackClassName="bg-muted text-foreground font-bold"
            />
          </div>
        </div>
      </div>

      {/* Name */}
      <p
        className={cn(
          "mt-2 truncate text-center font-bold tracking-[-0.01em] text-foreground",
          isFirst ? "max-w-[160px] text-sm" : "max-w-[130px] text-xs",
        )}
      >
        {user.name}
      </p>

      {/* Value */}
      <motion.span
        className={cn("mt-0.5 font-extrabold tabular-nums tracking-[-0.03em]", isFirst ? cn("text-lg", cfg.valueText) : cn("text-sm", cfg.valueText))}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: animDelay + 0.25 }}
      >
        {formatValue(user.value, metricType)}
      </motion.span>

      {/* Goal progress */}
      <div className="w-full px-1">
        <GoalProgressBar progress={user.goalProgress} delay={animDelay + 0.35} />
      </div>

      {/* Pedestal */}
      <motion.div
        className="mt-3 w-full"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          delay: animDelay + 0.15,
          type: "spring",
          stiffness: 160,
          damping: 18,
        }}
      >
        <Pedestal prize={prize} position={pos} />
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Single user card (edge case: only 1 user)
// ---------------------------------------------------------------------------

function SingleUserCard({
  user,
  prize,
  metricType,
}: {
  user: PodiumUser;
  prize: PodiumPrize | undefined;
  metricType: string;
}) {
  const cfg = POSITION_CONFIG[1];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 180, damping: 16 }}
      className="mx-auto flex w-[220px] flex-col items-center p-4"
    >
      <CrownBadge />

      <div className="relative mt-3">
        <PositionBadge position={1} />
        <div
          className={cn(
            "rounded-full p-[3px]",
            cfg.ring,
            cfg.shadowGlow,
          )}
        >
          <div className="rounded-full bg-card p-[2px]">
            <UserAvatar
              name={user.name}
              avatarUrl={user.avatarUrl}
              size="2xl"
              className="h-[88px] w-[88px]"
              fallbackClassName="bg-muted text-foreground font-bold"
            />
          </div>
        </div>
      </div>

      <p className="mt-3 text-base font-bold tracking-[-0.01em] text-foreground">{user.name}</p>

      <motion.span
        className="mt-1 text-xl font-extrabold tabular-nums tracking-[-0.03em] text-primary-soft-foreground"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        {formatValue(user.value, metricType)}
      </motion.span>

      <div className="w-full px-1">
        <GoalProgressBar progress={user.goalProgress} delay={0.5} />
      </div>

      {prize && (
        <div className="mt-4 w-full rounded-2xl border border-primary/30 bg-primary-soft py-2.5 text-center">
          <span className="text-lg">{prize.prize_icon}</span>
          <p className="text-xs font-bold text-primary-soft-foreground">
            {prize.prize_name}
          </p>
          {prize.prize_value != null && (
            <p className="text-[10px] tabular-nums text-muted-foreground">
              R$ {prize.prize_value.toLocaleString("pt-BR")}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Builds the visual slot order (2nd left, 1st center, 3rd right) from a list of users.
 * Each user gets rendered into the slot matching their position.
 */
function buildVisualSlots(
  usersInTop3: PodiumUser[],
): (PodiumUser | null)[] {
  // We always want: position 2 (left), position 1 (center), position 3 (right)
  const byPos = new Map(usersInTop3.map(u => [u.position, u]));
  return [byPos.get(2) ?? null, byPos.get(1) ?? null, byPos.get(3) ?? null];
}

function CompetitionPodiumV2Base({
  users,
  prizes,
  metricType = "sales",
  getChange,
  isAnimatingTransitions,
  previousRanking,
}: CompetitionPodiumV2Props) {
  const prizeMap = new Map(prizes.map((p) => [p.position, p]));
  const top3 = users.slice(0, 3);
  const hasTransition = isAnimatingTransitions && previousRanking && previousRanking.length > 0;

  // Phase state: "old" = showing previous positions, "current" = showing current
  const [phase, setPhase] = useState<"old" | "current">(hasTransition ? "old" : "current");
  // Whether badges should be visible
  const [showBadges, setShowBadges] = useState(false);

  useEffect(() => {
    if (!hasTransition) {
      setPhase("current");
      return;
    }

    // Start in "old" phase, transition to "current" after delay
    setPhase("old");
    const transitionTimer = setTimeout(() => {
      setPhase("current");
      setShowBadges(true);
    }, 1500);

    // Hide badges after total animation time
    const badgeTimer = setTimeout(() => {
      setShowBadges(false);
    }, 4000);

    return () => {
      clearTimeout(transitionTimer);
      clearTimeout(badgeTimer);
    };
  }, [hasTransition]);

  // Memoize change lookup to prevent re-renders
  // NOTE: This useMemo MUST be called before any early returns to satisfy
  // the Rules of Hooks (same number of hooks on every render).
  const changeMap = useMemo(() => {
    const map = new Map<string, RankingChange | undefined>();
    for (const user of top3) {
      map.set(user.id, getChange?.(user.id));
    }
    return map;
  }, [top3, getChange]);

  if (top3.length === 0) return null;

  // Edge case: single user
  if (top3.length === 1) {
    return (
      <div className="relative overflow-hidden rounded-card border border-card-border bg-card px-4 py-8 shadow-relevo">
        <RadialGlow />
        <SingleUserCard
          user={top3[0]}
          prize={prizeMap.get(1)}
          metricType={metricType}
        />
      </div>
    );
  }

  // Build the users to display based on phase
  // In "old" phase: assign previous positions to current users so they render in old slots
  // In "current" phase: use actual positions
  let displayUsers: PodiumUser[];
  if (phase === "old" && previousRanking) {
    const prevPosMap = new Map(previousRanking.map(e => [e.id, e.position]));
    displayUsers = top3.map(u => {
      const prevPos = prevPosMap.get(u.id);
      // Clamp to 1-3 for podium display
      const displayPos = prevPos != null && prevPos >= 1 && prevPos <= 3 ? prevPos : u.position;
      return { ...u, position: displayPos };
    });
    // If a user wasn't in top 3 before, they might overlap. Deduplicate positions.
    const usedPositions = new Set<number>();
    displayUsers = displayUsers.map(u => {
      if (usedPositions.has(u.position)) {
        // Find an unused position
        for (let p = 1; p <= 3; p++) {
          if (!usedPositions.has(p)) {
            usedPositions.add(p);
            return { ...u, position: p };
          }
        }
      }
      usedPositions.add(u.position);
      return u;
    });
  } else {
    displayUsers = top3;
  }

  const visualSlots = buildVisualSlots(displayUsers);

  return (
    <div className="relative w-full overflow-hidden rounded-card border border-card-border bg-card px-2 pb-0 pt-6 shadow-relevo sm:px-4">
      <RadialGlow />

      <LayoutGroup>
        <div className="relative z-10 flex items-end justify-center gap-3 sm:gap-5">
          {visualSlots.map((user) => {
            if (!user) return null;

            const pos = user.position as 1 | 2 | 3;
            const isFirst = pos === 1;
            const animDelay = isFirst ? 0.15 : pos === 2 ? 0.35 : 0.45;

            return (
              <motion.div
                key={user.id}
                layoutId={`podium-${user.id}`}
                layout
                transition={{
                  layout: { type: "spring", stiffness: 120, damping: 18, duration: 0.8 },
                }}
              >
                <PodiumSlot
                  user={user}
                  prize={prizeMap.get(pos)}
                  metricType={metricType}
                  animDelay={phase === "old" ? animDelay : 0}
                  isFirst={isFirst}
                  change={showBadges ? changeMap.get(user.id) : undefined}
                />
              </motion.div>
            );
          })}
        </div>
      </LayoutGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const CompetitionPodiumV2 = memo(CompetitionPodiumV2Base);
