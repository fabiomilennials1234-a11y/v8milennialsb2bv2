/**
 * useCopilotV2Agents — Slice 12b wizard-route data layer (Copilot v2).
 *
 * The Slice 8 wizard configures an EXISTING copilot_v2_agents row (keyed by
 * (org, archetype)); the foundation left that table write-deny and Slice 8 added
 * only SAVE/ACTIVATE. This hook adds the missing CREATE path (get-or-create via
 * the create_copilot_v2_agent RPC, org resolved server-side) + the org-scoped
 * LIST, plus the v1→v2 prefill seed (copilot-v2-prefill edge fn). All org
 * isolation + admin-gating is server-side (RLS SELECT + SECURITY DEFINER RPCs);
 * the FE never sends organization_id.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember, useOrganization } from "@/modules/identity";
import type { Archetype, CopilotV2Config } from "../lib/copilot-v2-config";

export interface CopilotV2AgentRow {
  id: string;
  organization_id: string;
  archetype: Archetype;
  is_active: boolean;
  model_id: string;
  created_at: string;
  updated_at: string;
}

/** Org-scoped list of the org's v2 agents (≤ 3 — one per archetype). */
export function useCopilotV2Agents() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;

  return useQuery<CopilotV2AgentRow[]>({
    queryKey: ["copilot_v2_agents", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("copilot_v2_agents")
        .select("id, organization_id, archetype, is_active, model_id, created_at, updated_at")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CopilotV2AgentRow[];
    },
  });
}

/**
 * Get-or-create the (org, archetype) agent.
 *
 * org is resolved from the active org context and forwarded as a DISAMBIGUATION
 * hint only — the SECURITY DEFINER RPC re-validates it is in the caller's admin
 * set (42501 otherwise), so trust is unchanged (the FE cannot reach another
 * tenant). Forwarding it is required because a master / multi-org admin's
 * get_my_admin_organization_ids() returns >1 org, which the RPC cannot
 * disambiguate on its own (raises 22023).
 */
export function useCreateCopilotV2Agent() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  return useMutation<CopilotV2AgentRow, Error, Archetype>({
    mutationFn: async (archetype) => {
      // RPC not yet in generated types — codebase convention is the `as any` cast.
      const { data, error } = await (supabase.rpc as any)("create_copilot_v2_agent", {
        p_archetype: archetype,
        p_organization_id: organizationId ?? null,
      });
      if (error) throw new Error(error.message ?? "create_copilot_v2_agent failed");
      return data as CopilotV2AgentRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["copilot_v2_agents"] });
    },
  });
}

// ── v1 → v2 prefill seed (admin-gated edge fn; pure transform server-side) ────

export interface PrefillCandidate {
  id: string;
  name: string | null;
  templateType: string | null;
}

export interface PrefillSeed {
  archetype: Archetype | null;
  config: CopilotV2Config;
  /** Required-set still missing for activation (operator must fill). */
  gaps: string[];
  /** v1 fields with no v2 home, preserved in the escape-hatch / surfaced. */
  dropped: string[];
}

export interface PrefillCandidatesResponse {
  organizationName: string | null;
  candidates: PrefillCandidate[];
}

export interface PrefillSeedResponse {
  sourceName: string | null;
  prefill: PrefillSeed;
}

/** List the org's legacy v1 agents for the "import from v1" picker. */
export function usePrefillCandidates() {
  const { organizationId } = useOrganization();
  return useMutation<PrefillCandidatesResponse, Error, void>({
    mutationFn: async () => {
      // organizationId disambiguates multi-org admins/masters; re-validated server-side.
      const { data, error } = await supabase.functions.invoke("copilot-v2-prefill", {
        body: { organizationId: organizationId ?? undefined },
      });
      if (error) throw error;
      return data as PrefillCandidatesResponse;
    },
  });
}

/** Seed a wizard draft from a chosen v1 agent (pure transform runs server-side). */
export function usePrefillFromV1() {
  const { organizationId } = useOrganization();
  return useMutation<PrefillSeedResponse, Error, { sourceAgentId: string; archetype?: Archetype }>({
    mutationFn: async (vars) => {
      const { data, error } = await supabase.functions.invoke("copilot-v2-prefill", {
        body: { ...vars, organizationId: organizationId ?? undefined },
      });
      if (error) throw error;
      return data as PrefillSeedResponse;
    },
  });
}
