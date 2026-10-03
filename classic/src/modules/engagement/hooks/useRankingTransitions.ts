import { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankingEntry {
  id: string;
  position: number;
}

export interface RankingChange {
  id: string;
  previousPosition: number;
  currentPosition: number;
  delta: number; // negative = moved up (improved), positive = moved down
  isNewLeader: boolean;
  isNew: boolean; // wasn't in previous ranking
}

interface StoredRanking {
  competitionId: string;
  entries: RankingEntry[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "ranking_last_seen";

function getStoredRanking(competitionId: string): RankingEntry[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored: StoredRanking = JSON.parse(raw);
    if (stored.competitionId !== competitionId) return null;
    return stored.entries;
  } catch {
    return null;
  }
}

function saveRanking(competitionId: string, entries: RankingEntry[]) {
  try {
    const stored: StoredRanking = {
      competitionId,
      entries,
      timestamp: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // localStorage unavailable
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Compares the current ranking with the last-seen ranking from localStorage.
 * Returns changes and a flag indicating whether to play the transition animation.
 *
 * Flow:
 * 1. On mount, load previous ranking from localStorage
 * 2. Compute diffs (who moved up, who moved down, new leader)
 * 3. After the animation delay, mark as "seen" and save current to localStorage
 */
export function useRankingTransitions(
  competitionId: string | null,
  currentRanking: RankingEntry[],
  /** Delay in ms before saving to localStorage (animation duration) */
  animationDurationMs = 2500,
) {
  const [changes, setChanges] = useState<RankingChange[]>([]);
  const [previousRanking, setPreviousRanking] = useState<RankingEntry[] | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const hasProcessed = useRef(false);
  const lastCompetitionId = useRef<string | null>(null);

  // Reset when competition changes
  if (competitionId !== lastCompetitionId.current) {
    lastCompetitionId.current = competitionId;
    hasProcessed.current = false;
  }

  // Compute changes on first render only (not on re-renders from data updates)
  useEffect(() => {
    if (!competitionId || currentRanking.length === 0 || hasProcessed.current) return;
    hasProcessed.current = true;

    const stored = getStoredRanking(competitionId);

    if (!stored || stored.length === 0) {
      // First time seeing this competition — no animation, just save
      saveRanking(competitionId, currentRanking.map(e => ({ id: e.id, position: e.position })));
      return;
    }

    // Build position map from stored ranking
    const prevMap = new Map(stored.map(e => [e.id, e.position]));

    // Compute changes
    const diffs: RankingChange[] = [];
    let hasAnyChange = false;

    for (const entry of currentRanking) {
      const prevPos = prevMap.get(entry.id);
      const isNew = prevPos === undefined;
      const previousPosition = prevPos ?? entry.position;
      const delta = entry.position - previousPosition; // negative = improved

      if (isNew || delta !== 0) {
        hasAnyChange = true;
      }

      diffs.push({
        id: entry.id,
        previousPosition,
        currentPosition: entry.position,
        delta,
        isNewLeader: entry.position === 1 && previousPosition !== 1,
        isNew,
      });
    }

    if (!hasAnyChange) {
      // No changes — save and skip animation
      saveRanking(competitionId, currentRanking.map(e => ({ id: e.id, position: e.position })));
      return;
    }

    // Store previous ranking for the animation start state
    setPreviousRanking(stored);
    setChanges(diffs);
    setIsAnimating(true);

    // After animation completes, save current as seen
    const timer = setTimeout(() => {
      setIsAnimating(false);
      saveRanking(competitionId, currentRanking.map(e => ({ id: e.id, position: e.position })));
    }, animationDurationMs);

    return () => clearTimeout(timer);
  }, [competitionId, currentRanking, animationDurationMs]);

  /** Get the change info for a specific user */
  const getChange = useCallback(
    (userId: string): RankingChange | undefined => changes.find(c => c.id === userId),
    [changes],
  );

  /** Get the previous position for a user (for animation start state) */
  const getPreviousPosition = useCallback(
    (userId: string): number | undefined => {
      if (!previousRanking) return undefined;
      return previousRanking.find(e => e.id === userId)?.position;
    },
    [previousRanking],
  );

  return {
    changes,
    isAnimating,
    hasChanges: changes.length > 0 && changes.some(c => c.delta !== 0 || c.isNew),
    getChange,
    getPreviousPosition,
    previousRanking,
  };
}
