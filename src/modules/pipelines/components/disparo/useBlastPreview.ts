import { useEffect, useMemo, useRef, useState } from "react";

import { useDebounce } from "@/shared/hooks/useDebounce";
import { useQuickBlastPreview, type QuickBlastInput, type QuickBlastPreview } from "@/modules/leads";

export interface BlastRefinements {
  /** Toggle for `exclude_blasted_within_days`. */
  excludeRecent: boolean;
  /** Recency window in days — only sent when `excludeRecent` is on and N > 0. */
  recentDays: number;
  /** Maps to `only_non_responders`. */
  onlyNonResponders: boolean;
}

export const DEFAULT_RECENT_DAYS = 7;

export const DEFAULT_REFINEMENTS: BlastRefinements = {
  excludeRecent: false,
  recentDays: DEFAULT_RECENT_DAYS,
  onlyNonResponders: false,
};

/**
 * Resolve the refinement toggles into the wire fields the engine understands.
 * `exclude_blasted_within_days` only engages with a positive integer window;
 * `only_non_responders` is sent solely when true. Both omit otherwise so the
 * server treats them as "no narrowing".
 */
export function resolveRefinementFields(
  r: BlastRefinements,
): Pick<QuickBlastInput, "exclude_blasted_within_days" | "only_non_responders"> {
  const fields: Pick<QuickBlastInput, "exclude_blasted_within_days" | "only_non_responders"> = {};
  if (r.excludeRecent && Number.isInteger(r.recentDays) && r.recentDays > 0) {
    fields.exclude_blasted_within_days = r.recentDays;
  }
  if (r.onlyNonResponders) fields.only_non_responders = true;
  return fields;
}

interface UseBlastPreviewArgs {
  /** Resolved candidate lead ids for the chosen stage. */
  leadIds: string[] | undefined;
  /** Selected instance, or a fallback connected one purely for counting. */
  instanceId: string | undefined;
  /** Current draft message — the preview tolerates an empty string. */
  message: string;
  refinements: BlastRefinements;
  /** Skip the network call entirely (e.g. dialog closed). */
  enabled: boolean;
}

export interface BlastPreviewState {
  /** Last successful would-send count + breakdown, or null before first run. */
  data: QuickBlastPreview | null;
  isLoading: boolean;
  /** True once the resolved inputs differ from the last settled preview. */
  isStale: boolean;
  error: string | null;
}

/**
 * Orchestrates the dry-run preview for the Disparo wizard: debounces the
 * resolved inputs, fires `useQuickBlastPreview` (never sends), and exposes a
 * graceful loading/stale/error state. A preview hiccup must never block the
 * fire button — the server re-resolves authoritatively on fire.
 */
export function useBlastPreview({
  leadIds,
  instanceId,
  message,
  refinements,
  enabled,
}: UseBlastPreviewArgs): BlastPreviewState {
  const preview = useQuickBlastPreview();

  const refinementFields = resolveRefinementFields(refinements);

  // Serialize the inputs that should trigger a refetch. Message is intentionally
  // excluded — it does not change the audience math, only the eventual copy.
  const inputKey = useMemo(
    () =>
      JSON.stringify({
        leadIds: leadIds ?? [],
        instanceId: instanceId ?? "",
        ...refinementFields,
      }),
    // refinementFields is derived synchronously from refinements; stringified key is the dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(leadIds ?? []), instanceId, JSON.stringify(refinementFields)],
  );

  const debouncedKey = useDebounce(inputKey, 350);
  const isStale = enabled && debouncedKey !== inputKey;

  const [data, setData] = useState<QuickBlastPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track the latest request so a slow earlier response can't clobber a newer one.
  const requestSeq = useRef(0);
  const mutateRef = useRef(preview.mutateAsync);
  mutateRef.current = preview.mutateAsync;

  useEffect(() => {
    if (!enabled || !instanceId || !leadIds || leadIds.length === 0) {
      setData(null);
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    const parsed = JSON.parse(debouncedKey) as {
      leadIds: string[];
      instanceId: string;
      exclude_blasted_within_days?: number;
      only_non_responders?: boolean;
    };
    mutateRef
      .current({
        instance_id: parsed.instanceId,
        lead_ids: parsed.leadIds,
        message,
        exclude_blasted_within_days: parsed.exclude_blasted_within_days,
        only_non_responders: parsed.only_non_responders,
      })
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setData(res);
        setError(null);
      })
      .catch((e: unknown) => {
        if (seq !== requestSeq.current) return;
        setError((e as Error)?.message ?? "Falha ao calcular o público");
      });
    // `message` deliberately omitted — it never alters the audience math.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, enabled, instanceId, leadIds]);

  return {
    data,
    isLoading: enabled && (preview.isPending || isStale),
    isStale,
    error,
  };
}
