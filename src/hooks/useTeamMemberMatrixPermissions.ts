import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Carrega todas as entries de `team_member_permissions` do membro como
 * um Map<"resource:action", "allowed" | "denied">. Sem entry → caller
 * trata como default "allowed" (paridade com server engine).
 *
 * Usado por `useCanPerformAction` em `src/lib/permissions.ts`.
 */
export function useTeamMemberMatrixPermissions(teamMemberId: string | null | undefined) {
  return useQuery({
    queryKey: ["team-member-matrix-permissions", teamMemberId],
    queryFn: async (): Promise<Map<string, "allowed" | "denied">> => {
      if (!teamMemberId) return new Map();
      const { data, error } = await supabase
        .from("team_member_permissions")
        .select("resource_key, action_key, value")
        .eq("team_member_id", teamMemberId);

      if (error) throw error;

      const map = new Map<string, "allowed" | "denied">();
      for (const row of data ?? []) {
        const value = row.value === "denied" ? "denied" : "allowed";
        map.set(`${row.resource_key}:${row.action_key}`, value);
      }
      return map;
    },
    enabled: !!teamMemberId,
    staleTime: 5 * 60 * 1000,
  });
}
