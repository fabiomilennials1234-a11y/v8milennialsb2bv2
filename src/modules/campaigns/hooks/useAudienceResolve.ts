/**
 * useAudienceResolve — live audience resolution for the Disparos wizard (#902).
 *
 * Thin React shell over the pure `audience-resolve` core. Composes the existing
 * pipelines RPC hooks (`useStageLeadIds` / `useFilteredLeadIds` /
 * `useCustomFilteredLeadIds` / `useAllFunnelsLeadIds`, all org-scoped
 * server-side — the front never sends org_id as authority) and returns the
 * single active candidate set for the chosen source.
 *
 * ONE query resolves the audience — never a client-side fan-out across funnels.
 * The frozen `leadIds` handed to the blast is exactly what the live counter
 * showed, with no intermediate partial state.
 *
 * Hooks run unconditionally (Rules of Hooks); inactive resolvers are gated to a
 * cheap empty result — stage via an empty stageKey (the hook's own `enabled`),
 * custom via a null pipelineId, all-funnels via a real `enabled` flag, and the
 * filtered RPC via a sentinel stage that matches no rows. The sentinel exists
 * only because the inherited hooks expose no `enabled`; new code uses the flag.
 * The pure `resolverFor` decides which one is authoritative.
 */
import { useMemo } from "react";
import {
  useStageLeadIds,
  useFilteredLeadIds,
  useCustomFilteredLeadIds,
  useAllFunnelsLeadIds,
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

  // Whole-funnel scope sends a NULL stage to the RPCs, which read it as "every
  // stage". Only get_filtered_lead_ids / get_custom_filtered_lead_ids accept it.
  const wholeFunnel = sel.stageScope === "all";

  // system, ONE plain stage (no conditions) — gated by the hook's own
  // `enabled:!!stageKey`. Never reached with a whole-funnel scope (resolverFor
  // routes that to "filtered": get_stage_lead_ids has no NULL-stage escape).
  const stage = useStageLeadIds(sel.pipelineType, kind === "stage" ? sel.stageKey : "");

  // system, narrowed and/or whole-funnel — sentinel stage keeps the query empty
  // when inactive; null stage means "every stage of this pipe".
  const filtered = useFilteredLeadIds(sel.pipelineType, {
    stageKey: kind === "filtered" ? (wholeFunnel ? null : sel.stageKey) : INACTIVE_STAGE,
    ...conditionFields,
  });

  // custom pipeline, one stage or whole — gated by the hook's own
  // `enabled:!!pipelineId`.
  const custom = useCustomFilteredLeadIds(kind === "custom" ? sel.pipelineId : null, {
    stageId: kind === "custom" && !wholeFunnel ? sel.stageKey : null,
    ...conditionFields,
  });

  // every funnel at once, deduplicated server-side — gated by a real `enabled`.
  const allFunnels = useAllFunnelsLeadIds(conditionFields, {
    enabled: kind === "all-funnels",
  });

  return useMemo<ResolvedAudience>(() => {
    const active =
      kind === "stage"
        ? stage
        : kind === "filtered"
          ? filtered
          : kind === "custom"
            ? custom
            : kind === "all-funnels"
              ? allFunnels
              : null;
    if (!active) return { leadIds: [], count: 0, isLoading: false, isError: false };
    const leadIds = active.data ?? [];
    return {
      leadIds,
      count: leadIds.length,
      isLoading: active.isLoading,
      isError: active.isError,
    };
  }, [kind, stage, filtered, custom, allFunnels]);
}
