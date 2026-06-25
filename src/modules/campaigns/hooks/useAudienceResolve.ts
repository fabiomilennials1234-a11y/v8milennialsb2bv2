/**
 * useAudienceResolve — live audience resolution for the Disparos wizard (#902).
 *
 * Thin React shell over the pure `audience-resolve` core. Composes the existing
 * pipelines RPC hooks (`useStageLeadIds` / `useFilteredLeadIds` /
 * `useCustomFilteredLeadIds`, all org-scoped server-side — the front never sends
 * org_id) and returns the single active candidate set for the chosen source.
 *
 * Hooks run unconditionally (Rules of Hooks); inactive resolvers are gated to a
 * cheap empty result — stage via an empty stageKey (the hook's own `enabled`),
 * custom via a null pipelineId, and the filtered RPC via a sentinel stage that
 * matches no rows. The pure `resolverFor` decides which one is authoritative.
 */
import { useMemo } from "react";
import {
  useStageLeadIds,
  useFilteredLeadIds,
  useCustomFilteredLeadIds,
} from "@/modules/pipelines";
import {
  resolverFor,
  type AudienceSelection,
} from "../components/disparo-wizard/audience-resolve";

/** A stage_key that matches no lead — gates the filtered RPC to an empty result. */
const INACTIVE_STAGE = "__disparo_inactive__";

export interface ResolvedAudience {
  leadIds: string[];
  count: number;
  isLoading: boolean;
  isError: boolean;
}

export function useAudienceResolve(sel: AudienceSelection): ResolvedAudience {
  const kind = resolverFor(sel);

  const conditionFields = {
    tagIds: sel.conditions.tagIds,
    qualificationTier: sel.conditions.qualificationTier,
    preQualificationTier: sel.conditions.preQualificationTier,
    origin: sel.conditions.origin,
  };

  // system, plain stage (no conditions) — gated by the hook's own `enabled:!!stageKey`.
  const stage = useStageLeadIds(sel.pipelineType, kind === "stage" ? sel.stageKey : "");

  // system, narrowed stage — sentinel stage keeps the query empty when inactive.
  const filtered = useFilteredLeadIds(sel.pipelineType, {
    stageKey: kind === "filtered" ? sel.stageKey : INACTIVE_STAGE,
    ...conditionFields,
  });

  // custom pipeline stage — gated by the hook's own `enabled:!!pipelineId`.
  const custom = useCustomFilteredLeadIds(kind === "custom" ? sel.pipelineId : null, {
    stageId: kind === "custom" ? sel.stageKey : null,
    ...conditionFields,
  });

  return useMemo<ResolvedAudience>(() => {
    const active =
      kind === "stage"
        ? stage
        : kind === "filtered"
          ? filtered
          : kind === "custom"
            ? custom
            : null;
    if (!active) return { leadIds: [], count: 0, isLoading: false, isError: false };
    const leadIds = active.data ?? [];
    return {
      leadIds,
      count: leadIds.length,
      isLoading: active.isLoading,
      isError: active.isError,
    };
  }, [kind, stage, filtered, custom]);
}
