import type { StageRailPipe } from "./StageRail";

/**
 * pipeRanking — helpers to decide *which* rail starts expanded when a lead
 * lives in more than one pipe, and to persist the user's choice across
 * modal openings.
 *
 * Heuristic for the "current" pipe (default expanded when no stored focus):
 *
 *   upsell  >  propostas  >  confirmacao  >  qualificacao  >  custom
 *
 * Rationale: the rail the user almost always cares about is the *furthest
 * along the funnel*. Custom pipes never compete for that slot — if any
 * system pipe is active, it wins. If only custom pipes are active the
 * first one in the rendered order is picked (the parent already sorts
 * them stably).
 */

const SYSTEM_RANK: Record<string, number> = {
  // pipeRef values (see SYSTEM_RAIL_REF in CrossPipePanel.tsx)
  upsell_base: 40, // not used today but reserved for future upsell rails
  upsell: 40,
  propostas: 30,
  confirmacao: 20,
  whatsapp: 10,
};

/** Stable key used both for React `key` and as the expandedRailKey value. */
export function railKey(rail: Pick<StageRailPipe, "kind" | "recordId">): string {
  return `${rail.kind}:${rail.recordId}`;
}

/** Heuristic: most-advanced system pipe wins; fallback to first custom. */
export function pickDefaultExpanded(rails: StageRailPipe[]): string | null {
  if (rails.length === 0) return null;

  let bestKey: string | null = null;
  let bestRank = -Infinity;

  for (const r of rails) {
    if (r.kind !== "system") continue;
    const rank = SYSTEM_RANK[r.pipeRef] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      bestKey = railKey(r);
    }
  }

  if (bestKey) return bestKey;
  // No system rails — pick first custom (parent already orders them).
  return railKey(rails[0]);
}

export function focusStorageKey(
  userId: string | null | undefined,
  leadId: string,
): string {
  return `lead-modal:pipe-focus:${userId ?? "anon"}:${leadId}`;
}

/**
 * Reads the stored focus and returns it ONLY if it still matches one of
 * the current rails. Otherwise returns null so the caller can fall back to
 * the heuristic (which covers the "pipe was removed between sessions"
 * case from the brief).
 */
export function loadStoredFocus(
  key: string,
  rails: StageRailPipe[],
): string | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  const valid = rails.some((r) => railKey(r) === raw);
  return valid ? raw : null;
}

export function persistFocus(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* storage disabled — silently ignore */
  }
}
