/**
 * useCopilotV2Config — Slice 8 wizard data layer (Copilot v2).
 *
 * Read: hydrates the agent's config from copilot_v2_config (slots + escape-hatch)
 * and copilot_v2_rubric (rules) — both org-scoped by RLS. Write: posts to the
 * copilot-v2-save-config edge function, which runs the fail-CLOSED orchestration
 * (schema → linter → activation → transactional save) server-side. The mutation
 * surfaces the structured result so the wizard can show inline linter/activation
 * errors instead of a generic toast.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import type { CopilotV2Config, RubricRule, SavePayload } from "../lib/copilot-v2-config";

export interface LoadedConfig {
  config: CopilotV2Config;
  rubricRules: RubricRule[];
}

export type SaveResult =
  | { status: "ok"; config: CopilotV2Config }
  | { status: "invalid"; errors: string[] }
  | { status: "rejected"; reason: string }
  | { status: "not_activatable"; missingHard: string[]; missingSoft?: string[] };

const EMPTY: LoadedConfig = { config: { capabilities: {} }, rubricRules: [] };

export function useCopilotV2Config(agentId: string | undefined) {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;

  return useQuery<LoadedConfig>({
    queryKey: ["copilot_v2_config", agentId, orgId],
    enabled: !!agentId && !!orgId,
    queryFn: async () => {
      if (!agentId) return EMPTY;

      const [{ data: cfg }, { data: rub }] = await Promise.all([
        supabase
          .from("copilot_v2_config")
          .select("slots, escape_hatch_notes")
          .eq("agent_id", agentId)
          .maybeSingle(),
        supabase.from("copilot_v2_rubric").select("rules").eq("agent_id", agentId).maybeSingle(),
      ]);

      const slots = (cfg?.slots as Record<string, unknown> | null) ?? {};
      const config: CopilotV2Config = {
        ...(slots as CopilotV2Config),
        capabilities: (slots as CopilotV2Config).capabilities ?? {},
        escapeHatchNotes: cfg?.escape_hatch_notes ?? null,
      };
      const rubricRules = (Array.isArray(rub?.rules) ? rub?.rules : []) as unknown as RubricRule[];
      return { config, rubricRules };
    },
  });
}

async function readStructuredError(error: unknown): Promise<SaveResult | null> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      return (await ctx.json()) as SaveResult;
    } catch {
      return null;
    }
  }
  return null;
}

export function useSaveCopilotV2Config() {
  const queryClient = useQueryClient();

  return useMutation<SaveResult, Error, SavePayload>({
    mutationFn: async (payload: SavePayload) => {
      const { data, error } = await supabase.functions.invoke("copilot-v2-save-config", { body: payload });
      if (error) {
        const structured = await readStructuredError(error);
        if (structured) return structured; // 422/409 carry a structured body the UI renders inline
        throw error;
      }
      return data as SaveResult;
    },
    onSuccess: (result, payload) => {
      if (result.status === "ok") {
        queryClient.invalidateQueries({ queryKey: ["copilot_v2_config", payload.agentId] });
        queryClient.invalidateQueries({ queryKey: ["copilot_v2_agents"] });
      }
    },
  });
}
