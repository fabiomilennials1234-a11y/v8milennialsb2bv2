/**
 * Hooks para gerenciamento de badges (gamificação OUTBOUND)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
export interface Badge {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  criteria_type: string;
  criteria_value: number;
  is_system: boolean;
  created_at: string;
}

export interface UserBadge {
  id: string;
  badge_id: string;
  team_member_id: string;
  unlocked_at: string;
}

/**
 * Lista todos os badges da org atual
 */
export function useBadges() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["badges", organizationId],
    queryFn: async (): Promise<Badge[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("badges")
        .select("*")
        .eq("organization_id", organizationId)
        .order("criteria_value", { ascending: true });

      if (error) throw error;
      return (data ?? []) as Badge[];
    },
    enabled: isReady && !!organizationId,
  });
}

/**
 * Lista badges desbloqueados de um team_member
 */
export function useUserBadges(teamMemberId: string | null) {
  return useQuery({
    queryKey: ["user-badges", teamMemberId],
    queryFn: async (): Promise<UserBadge[]> => {
      if (!teamMemberId) return [];

      const { data, error } = await supabase
        .from("user_badges")
        .select("*")
        .eq("team_member_id", teamMemberId);

      if (error) throw error;
      return (data ?? []) as UserBadge[];
    },
    enabled: !!teamMemberId,
  });
}

/**
 * Criar badge customizado
 */
export function useCreateBadge() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (badge: {
      name: string;
      description?: string;
      icon?: string;
      criteria_type: string;
      criteria_value: number;
    }) => {
      if (!organizationId) throw new Error("Organization not available");

      const { data, error } = await supabase
        .from("badges")
        .insert({
          organization_id: organizationId,
          name: badge.name,
          description: badge.description ?? null,
          icon: badge.icon ?? null,
          criteria_type: badge.criteria_type,
          criteria_value: badge.criteria_value,
          is_system: false,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["badges", organizationId] });
    },
  });
}

/**
 * Deletar badge customizado (apenas is_system = false)
 */
export function useDeleteBadge() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (badgeId: string) => {
      const { error } = await supabase
        .from("badges")
        .delete()
        .eq("id", badgeId)
        .eq("is_system", false); // Proteção: nunca deletar badges do sistema

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["badges", organizationId] });
    },
  });
}

/**
 * Desbloquear um badge para um team_member
 */
export function useUnlockBadge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      badgeId,
      teamMemberId,
    }: {
      badgeId: string;
      teamMemberId: string;
    }) => {
      const { error } = await supabase
        .from("user_badges")
        .insert({
          badge_id: badgeId,
          team_member_id: teamMemberId,
        })
        .select()
        .single();

      // Ignorar erro de duplicata (badge já desbloqueado)
      if (error && !error.message.includes("duplicate")) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["user-badges", variables.teamMemberId],
      });
    },
  });
}
