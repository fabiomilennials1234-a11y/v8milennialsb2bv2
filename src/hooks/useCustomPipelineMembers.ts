import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type MemberRole = "sdr" | "closer" | "participant";

export interface CustomPipelineMember {
  id: string;
  organization_id: string;
  pipeline_id: string;
  team_member_id: string;
  role: MemberRole;
  goal_count: number;
  achieved_count: number;
  bonus_earned: boolean;
  created_at: string;
  // Joins
  team_member?: {
    id: string;
    profile_id: string;
    profiles: {
      id: string;
      full_name: string | null;
      avatar_url: string | null;
    } | null;
  };
}

// ────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────

/** Lista membros de um funil (temporário ou permanente) */
export function usePipelineMembers(pipelineId: string | undefined) {
  return useQuery({
    queryKey: ["custom_pipeline_members", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return [];

      const { data, error } = await supabase
        .from("custom_pipeline_members")
        .select(`
          *,
          team_member:team_members(
            id,
            profile_id,
            profiles(id, full_name, avatar_url)
          )
        `)
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data || []) as CustomPipelineMember[];
    },
    enabled: !!pipelineId,
  });
}

// ────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────

/** Adicionar membro ao funil */
export function useAddPipelineMember() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      pipeline_id,
      team_member_id,
      role = "participant",
      goal_count = 0,
    }: {
      pipeline_id: string;
      team_member_id: string;
      role?: MemberRole;
      goal_count?: number;
    }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Organização não encontrada");
      }

      const { data, error } = await supabase
        .from("custom_pipeline_members")
        .insert({
          organization_id: teamMember.organization_id,
          pipeline_id,
          team_member_id,
          role,
          goal_count,
        })
        .select()
        .single();

      if (error) {
        if (error.message?.includes("duplicate")) {
          throw new Error("Este membro já está neste funil");
        }
        throw error;
      }
      return data as CustomPipelineMember;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_members", variables.pipeline_id] });
    },
  });
}

/** Atualizar membro (role, goal, achieved, bonus) */
export function useUpdatePipelineMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      pipeline_id,
      ...updates
    }: {
      id: string;
      pipeline_id: string;
      role?: MemberRole;
      goal_count?: number;
      achieved_count?: number;
      bonus_earned?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("custom_pipeline_members")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as CustomPipelineMember;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_members", variables.pipeline_id] });
    },
  });
}

/** Remover membro do funil */
export function useRemovePipelineMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, pipeline_id }: { id: string; pipeline_id: string }) => {
      const { error } = await supabase
        .from("custom_pipeline_members")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_members", variables.pipeline_id] });
    },
  });
}

/** Incrementar achieved_count de um membro */
export function useIncrementMemberAchieved() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, pipeline_id }: { id: string; pipeline_id: string }) => {
      // Read current value first
      const { data: current, error: readError } = await supabase
        .from("custom_pipeline_members")
        .select("achieved_count")
        .eq("id", id)
        .single();

      if (readError) throw readError;

      const { data, error } = await supabase
        .from("custom_pipeline_members")
        .update({ achieved_count: (current.achieved_count || 0) + 1 })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as CustomPipelineMember;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["custom_pipeline_members", variables.pipeline_id] });
    },
  });
}
