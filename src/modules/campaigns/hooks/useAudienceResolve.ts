/**
 * useAudienceResolve — live audience resolution for the Disparos wizard (#902).
 *
 * Thin React shell over the pure `audience-resolve` core. Fatia B (Funil é
 * Funil): a família de resolvers por tipo de funil morreu — UM funil resolve
 * por `usePipelineLeadIds` (motor único `get_pipeline_lead_ids`, migration
 * 20270908003000) e "Todos os funis" por `useAllFunnelsLeadIds`. Ambos
 * org-scoped server-side — the front never sends org_id as authority.
 *
 * ONE query resolves the audience — never a client-side fan-out across funnels.
 * The frozen `leadIds` handed to the blast is exactly what the live counter
 * showed, with no intermediate partial state.
 *
 * Hooks run unconditionally (Rules of Hooks); inactive resolvers are gated to a
 * cheap empty result — the pipeline resolver via a null pipelineId (the hook's
 * own `enabled`), all-funnels via a real `enabled` flag. The pure `resolverFor`
 * decides which one is authoritative.
 */
import { useMemo } from "react";
import { useAllFunnelsLeadIds, usePipelineLeadIds } from "@/modules/pipelines";
import {
  resolverFor,
  type AudienceSelection,
} from "../components/disparo-wizard/audience-resolve";

export interface ResolvedAudience {
  leadIds: string[];
  count: number;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Lista vazia ESTÁVEL. O resultado de `useQuery` é um objeto novo a cada
 * render, então um `[]` literal aqui também seria — e o efeito do
 * `AudienceByStage` que espelha `leadIds` no rascunho dispararia a cada render
 * enquanto nada está escolhido ("Maximum update depth exceeded").
 */
const NO_LEADS: string[] = [];

export function useAudienceResolve(sel: AudienceSelection): ResolvedAudience {
  const kind = resolverFor(sel);

  const conditionFields = {
    tagIds: sel.conditions.tagIds,
    qualificationTier: sel.conditions.qualificationTier,
    preQualificationTier: sel.conditions.preQualificationTier,
    origin: sel.conditions.origin,
  };

  // ONE funnel (any type), one stage or whole. A null stageId means "every
  // stage of this funnel" (the RPC's p_stage_id NULL escape); a null pipelineId
  // disables the query via the hook's own `enabled`.
  const pipeline = usePipelineLeadIds(kind === "pipeline" ? sel.pipelineId : null, {
    stageId: kind === "pipeline" && sel.stageScope === "one" ? sel.stageId || null : null,
    ...conditionFields,
  });

  // Every funnel at once, deduplicated server-side — gated by a real `enabled`.
  const allFunnels = useAllFunnelsLeadIds(conditionFields, {
    enabled: kind === "all-funnels",
  });

  const active =
    kind === "pipeline" ? pipeline : kind === "all-funnels" ? allFunnels : null;
  const leadIds = active?.data ?? NO_LEADS;
  const isLoading = active?.isLoading ?? false;
  const isError = active?.isError ?? false;

  return useMemo<ResolvedAudience>(
    () => ({ leadIds, count: leadIds.length, isLoading, isError }),
    [leadIds, isLoading, isError],
  );
}
