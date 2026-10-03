import { memo, useState, useEffect, useMemo } from "react";
import { motion, LayoutGroup } from "framer-motion";
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
  /** Cargo, abaixo do nome. */
  sub?: string;
  /** Nº de vendas (só quando a métrica é venda). */
  count?: number;
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

/** "R$ 94,8 mil" — o número do bloco; a unidade fica menor. */
function ValorPodio({ value, metricType, className }: { value: number; metricType: string; className?: string }) {
  if (metricType === "meetings") {
    return (
      <span className={className}>
        {value.toLocaleString("pt-BR")}
        <small className="ml-1 text-[0.5em] font-bold opacity-70">{value === 1 ? "reunião" : "reuniões"}</small>
      </span>
    );
  }
  if (value >= 1000) {
    return (
      <span className={className}>
        R$ {(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
        <small className="ml-0.5 text-[0.55em] font-bold opacity-70">mil</small>
      </span>
    );
  }
  return <span className={className}>R$ {value.toLocaleString("pt-BR")}</span>;
}

// ---------------------------------------------------------------------------
// Position config — V5 na tinta: o 1º é o bloco de ouro, 2º e 3º são vidro.
// ---------------------------------------------------------------------------

const POSITION_CONFIG = {
  1: {
    avatarSize: "2xl" as const,
    avatarClassName: "h-14 w-14 sm:h-[72px] sm:w-[72px]",
    ring: "bg-primary",
    blockHeight: "min-h-[160px] sm:min-h-[188px]",
    block: "bg-primary text-primary-foreground shadow-brilho-ouro",
    pill: "bg-tinta text-tinta-foreground",
    sub: "text-primary-foreground/70",
    value: "text-[clamp(1.05rem,4.2vw,2.1rem)]",
  },
  2: {
    avatarSize: "xl" as const,
    avatarClassName: "h-11 w-11 sm:h-14 sm:w-14",
    ring: "bg-silver",
    blockHeight: "min-h-[124px] sm:min-h-[148px]",
    block: "border border-tinta-line bg-tinta-2 text-tinta-foreground",
    pill: "bg-white/10 text-tinta-foreground",
    sub: "text-tinta-muted",
    value: "text-[clamp(0.95rem,3.4vw,1.45rem)]",
  },
  3: {
    avatarSize: "xl" as const,
    avatarClassName: "h-11 w-11 sm:h-14 sm:w-14",
    ring: "bg-warning",
    blockHeight: "min-h-[100px] sm:min-h-[118px]",
    block: "border border-tinta-line bg-tinta-2 text-tinta-foreground",
    pill: "bg-white/10 text-tinta-foreground",
    sub: "text-tinta-muted",
    value: "text-[clamp(0.95rem,3.4vw,1.45rem)]",
  },
} as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CrownBadge() {
  return (
    <motion.span
      className="block leading-none text-primary"
      animate={{ scale: [1, 1.06, 1], rotate: [0, 3, -3, 0] }}
      transition={{ repeat: Infinity, duration: 3, ease: [0.4, 0, 0.2, 1] }}
    >
      <Crown className="h-6 w-6 fill-primary/25" strokeWidth={2.2} aria-label="Líder" />
    </motion.span>
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
        className="mb-1 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-[.06em] text-primary-foreground"
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
        className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[.06em] text-tinta-foreground"
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
        "mb-1 inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tabular-nums",
        movedUp ? "bg-success/20 text-success-strong" : "bg-destructive/20 text-destructive",
      )}
      aria-label={movedUp ? `Subiu ${positions}` : `Caiu ${positions}`}
    >
      {movedUp ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
      {positions}
    </motion.div>
  );
});

// ---------------------------------------------------------------------------
// Bloco do pódio (o "degrau"): lugar, número, % da meta e o prêmio
// ---------------------------------------------------------------------------

function BlocoPodio({
  user,
  prize,
  metricType,
  position,
}: {
  user: PodiumUser;
  prize: PodiumPrize | undefined;
  metricType: string;
  position: 1 | 2 | 3;
}) {
  const cfg = POSITION_CONFIG[position];
  const contagem =
    metricType === "sales" && user.count != null
      ? `${user.count} ${user.count === 1 ? "venda" : "vendas"} · `
      : "";
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center gap-1.5 rounded-t-[22px] px-1.5 py-4 text-center sm:px-3",
        cfg.blockHeight,
        cfg.block,
      )}
    >
      <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold", cfg.pill)}>{position}º lugar</span>
      <ValorPodio
        value={user.value}
        metricType={metricType}
        className={cn("font-extrabold leading-none tracking-[-0.04em] tabular-nums", cfg.value)}
      />
      <span className={cn("text-[10.5px] font-semibold tabular-nums sm:text-[11.5px]", cfg.sub)}>
        {contagem}
        {Math.round(user.goalProgress)}% da meta
      </span>
      {position === 1 && user.goalProgress >= 100 && (
        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary-foreground/10 px-2.5 py-0.5 text-[11px] font-bold">
          <Flame className="h-3 w-3" aria-hidden />
          Meta batida
        </span>
      )}
      {prize && (
        <span className={cn("mt-1 max-w-full truncate text-[11px] font-semibold", cfg.sub)}>
          {prize.prize_icon} {prize.prize_name}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PodiumSlot (avatar + nome + bloco de um colocado)
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
      className="flex w-full min-w-0 flex-col items-center"
      initial={isFirst ? { opacity: 0, scale: 0.9 } : { opacity: 0, y: 30 }}
      animate={isFirst ? { opacity: 1, scale: 1 } : { opacity: 1, y: 0 }}
      transition={{ delay: animDelay, type: "spring", stiffness: isFirst ? 200 : 160, damping: isFirst ? 14 : 18 }}
    >
      <TransitionBadge change={change} />
      {isFirst && (
        <div className="mb-1">
          <CrownBadge />
        </div>
      )}
      <div className={cn("rounded-full p-[2px]", cfg.ring)}>
        <div className="rounded-full bg-tinta p-[2px]">
          <UserAvatar
            name={user.name}
            avatarUrl={user.avatarUrl}
            size={cfg.avatarSize}
            className={cfg.avatarClassName}
            fallbackClassName="bg-tinta-2 text-tinta-foreground font-bold"
          />
        </div>
      </div>
      <p className="mt-2 max-w-full truncate text-center text-[12.5px] font-bold text-tinta-foreground sm:text-[14px]">{user.name}</p>
      <p className="mb-3 h-4 max-w-full truncate text-center text-[11.5px] text-tinta-muted">{user.sub ?? ""}</p>
      <BlocoPodio user={user} prize={prize} metricType={metricType} position={pos} />
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

  // Um só colocado: o bloco de ouro sozinho, centrado.
  if (top3.length === 1) {
    return (
      <div className="mx-auto w-full max-w-[240px] pt-4">
        <PodiumSlot
          user={{ ...top3[0], position: 1 }}
          prize={prizeMap.get(1)}
          metricType={metricType}
          animDelay={0}
          isFirst
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

  // V5: o pódio mora dentro do painel de tinta (quem chama dá o InkPanel).
  // Três colunas iguais, 2º · 1º · 3º, alinhadas pela base dos blocos.
  return (
    <LayoutGroup>
      <div className="grid grid-cols-3 items-end gap-2 pt-4 sm:gap-3">
        {visualSlots.map((user, i) => {
          if (!user) return <div key={`vazio-${i}`} />;

          const pos = user.position as 1 | 2 | 3;
          const isFirst = pos === 1;
          const animDelay = isFirst ? 0.15 : pos === 2 ? 0.35 : 0.45;

          return (
            <motion.div
              key={user.id}
              layoutId={`podium-${user.id}`}
              layout
              className="min-w-0"
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
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const CompetitionPodiumV2 = memo(CompetitionPodiumV2Base);
