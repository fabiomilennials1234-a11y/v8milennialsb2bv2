import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type TeamMember = Tables<"team_members">;
export type TeamMemberInsert = TablesInsert<"team_members">;
export type TeamMemberUpdate = TablesUpdate<"team_members">;

// Hook to get the current user's team member record
export function useCurrentTeamMember() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ["team_members", "current", user?.id],
    queryFn: async () => {
      if (!user?.id) {
        console.log("🔍 useCurrentTeamMember: Sem user.id");
        return null;
      }
      
      console.log("🔍 useCurrentTeamMember: Buscando team_member para user:", user.id);
      
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      
      if (error) {
        console.error("❌ useCurrentTeamMember: Erro ao buscar:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: error,
        });
        throw error;
      }
      
      console.log("✅ useCurrentTeamMember: Resultado:", {
        hasData: !!data,
        organizationId: data?.organization_id,
        fullData: data,
      });
      
      return data as TeamMember | null;
    },
    enabled: !!user?.id,
    retry: 2,
    staleTime: 30000, // 30 segundos
  });
}

export function useTeamMembers() {
  return useQuery({
    queryKey: ["team_members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .order("name");
      
      if (error) {
        console.error("❌ useTeamMembers: Erro ao buscar:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: error,
        });
        throw error;
      }
      
      return data as TeamMember[];
    },
    retry: 1,
  });
}

export function useTeamMember(id: string) {
  return useQuery({
    queryKey: ["team_members", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("id", id)
        .single();
      
      if (error) throw error;
      return data as TeamMember;
    },
    enabled: !!id,
  });
}

export function useCreateTeamMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (member: TeamMemberInsert) => {
      const { data, error } = await supabase
        .from("team_members")
        .insert(member)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    },
  });
}

export function useUpdateTeamMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: TeamMemberUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("team_members")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    },
  });
}

export function useDeleteTeamMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("team_members")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    },
  });
}
