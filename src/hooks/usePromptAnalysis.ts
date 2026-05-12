import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

export interface PromptSuggestion {
  id: string;
  section: string;
  type: "add" | "rewrite" | "remove";
  field: string;
  current_text: string | null;
  suggested_text: string;
  reason: string;
  evidence: string[];
  confidence: number;
}

export interface PromptAnalysis {
  id: string;
  agent_id: string;
  suggestions: PromptSuggestion[];
  accepted_ids: string[];
  dismissed_ids: string[];
  conversation_count: number;
  message_count: number;
  created_at: string;
}

export function usePromptAnalysisHistory(agentId: string | undefined) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["prompt_analyses", agentId, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("copilot_prompt_analyses" as any)
        .select("*")
        .eq("agent_id", agentId!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as PromptAnalysis[];
    },
    enabled: !!agentId && !!organizationId,
  });
}

export function useRunPromptAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("analyze-copilot-prompt", {
        body: { agent_id: agentId },
      });

      if (res.error) throw res.error;
      const body = res.data as any;

      if (body.error === "rate_limited") {
        throw new Error(`rate_limited:${body.next_available_at}`);
      }
      if (body.error === "insufficient_data") {
        throw new Error(`insufficient_data:${body.min_required}:${body.found}`);
      }
      if (body.error) throw new Error(body.error);

      return body as {
        analysis_id: string;
        suggestions: PromptSuggestion[];
        conversation_count: number;
        message_count: number;
      };
    },
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["prompt_analyses", agentId] });
    },
  });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      analysisId,
      suggestion,
      agentId,
    }: {
      analysisId: string;
      suggestion: PromptSuggestion;
      agentId: string;
    }) => {
      const { data: agent, error: fetchErr } = await supabase
        .from("copilot_agents")
        .select("conversation_style, business_context")
        .eq("id", agentId)
        .single();
      if (fetchErr || !agent) throw fetchErr ?? new Error("Agent not found");

      const conversationStyle = (agent.conversation_style ?? {}) as Record<string, any>;
      const businessContext = (agent.business_context ?? {}) as Record<string, any>;

      if (["personality", "objective", "flow", "products", "instructions"].includes(suggestion.section)) {
        const promptSections = conversationStyle.promptSections ?? {};
        if (suggestion.type === "remove") {
          promptSections[suggestion.field] = "";
        } else {
          promptSections[suggestion.field] = suggestion.suggested_text;
        }
        conversationStyle.promptSections = promptSections;

        const { error } = await supabase
          .from("copilot_agents")
          .update({
            conversation_style: conversationStyle,
            system_prompt_version: (agent as any).system_prompt_version
              ? (agent as any).system_prompt_version + 1
              : 1,
          } as any)
          .eq("id", agentId);
        if (error) throw error;
      } else if (suggestion.section === "business_context") {
        if (suggestion.type === "remove") {
          delete businessContext[suggestion.field];
        } else {
          businessContext[suggestion.field] = suggestion.suggested_text;
        }
        const { error } = await supabase
          .from("copilot_agents")
          .update({ business_context: businessContext } as any)
          .eq("id", agentId);
        if (error) throw error;
      } else if (suggestion.section === "conversation_style") {
        if (suggestion.type === "remove") {
          delete conversationStyle[suggestion.field];
        } else {
          conversationStyle[suggestion.field] = suggestion.suggested_text;
        }
        const { error } = await supabase
          .from("copilot_agents")
          .update({ conversation_style: conversationStyle } as any)
          .eq("id", agentId);
        if (error) throw error;
      }

      // Mark suggestion as accepted in analysis record
      const { data: analysis } = await supabase
        .from("copilot_prompt_analyses" as any)
        .select("accepted_ids")
        .eq("id", analysisId)
        .single();
      const currentAccepted = (analysis as any)?.accepted_ids ?? [];
      await supabase
        .from("copilot_prompt_analyses" as any)
        .update({ accepted_ids: [...currentAccepted, suggestion.id] })
        .eq("id", analysisId);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["prompt_analyses", vars.agentId] });
      qc.invalidateQueries({ queryKey: ["copilot_agents"] });
      qc.invalidateQueries({ queryKey: ["copilot_agent_for_edit"] });
    },
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      analysisId,
      suggestionId,
      agentId,
    }: {
      analysisId: string;
      suggestionId: string;
      agentId: string;
    }) => {
      const { data: analysis } = await supabase
        .from("copilot_prompt_analyses" as any)
        .select("dismissed_ids")
        .eq("id", analysisId)
        .single();
      const currentDismissed = (analysis as any)?.dismissed_ids ?? [];
      await supabase
        .from("copilot_prompt_analyses" as any)
        .update({ dismissed_ids: [...currentDismissed, suggestionId] })
        .eq("id", analysisId);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["prompt_analyses", vars.agentId] });
    },
  });
}
