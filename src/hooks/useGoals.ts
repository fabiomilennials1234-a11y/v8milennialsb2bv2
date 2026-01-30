import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrganization } from "./useOrganization";

export interface Goal {
  id: string;
  name: string;
  type: string;
  target_value: number;
  current_value: number;
  month: number;
  year: number;
  team_member_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useGoals(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["goals", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("goals")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("month", selectedMonth)
        .eq("year", selectedYear);

      if (error) throw error;
      return data as Goal[];
    },
    enabled: isReady && !!organizationId,
  });
}

export function useTeamGoals(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["team-goals", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data: goals, error } = await supabase
        .from("goals")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("month", selectedMonth)
        .eq("year", selectedYear)
        .is("team_member_id", null);

      if (error) throw error;
      return goals as Goal[];
    },
    enabled: isReady && !!organizationId,
  });
}

export function useIndividualGoals(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["individual-goals", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      if (!organizationId) return { closerGoals: [], sdrGoals: [] };
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("id, name, role")
        .eq("organization_id", organizationId)
        .eq("is_active", true);

      const { data: goals, error } = await supabase
        .from("goals")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("month", selectedMonth)
        .eq("year", selectedYear)
        .not("team_member_id", "is", null);

      if (error) throw error;

      // Combine with team member info
      const closers = teamMembers?.filter((m) => m.role === "closer") || [];
      const sdrs = teamMembers?.filter((m) => m.role === "sdr") || [];

      const closerGoals = closers.map((closer) => {
        const goal = goals?.find(
          (g) => g.team_member_id === closer.id && g.type === "vendas"
        );
        return {
          id: closer.id,
          name: closer.name,
          role: "closer",
          current: goal?.current_value || 0,
          goal: goal?.target_value || 0,
          percentage: goal?.target_value
            ? Math.round((goal.current_value / goal.target_value) * 100)
            : 0,
        };
      });

      const sdrGoals = sdrs.map((sdr) => {
        const goal = goals?.find(
          (g) => g.team_member_id === sdr.id && g.type === "reunioes"
        );
        return {
          id: sdr.id,
          name: sdr.name,
          role: "sdr",
          current: goal?.current_value || 0,
          goal: goal?.target_value || 0,
          percentage: goal?.target_value
            ? Math.round((goal.current_value / goal.target_value) * 100)
            : 0,
        };
      });

      return { closerGoals, sdrGoals };
    },
    enabled: isReady && !!organizationId,
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (goal: Omit<Goal, "id" | "created_at" | "updated_at">) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const securedGoal = { ...goal, organization_id: organizationId };
      const { data, error } = await supabase
        .from("goals")
        .insert([securedGoal])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["team-goals"] });
      queryClient.invalidateQueries({ queryKey: ["individual-goals"] });
      toast.success("Meta criada com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao criar meta: " + error.message);
    },
  });
}

export function useUpdateGoal() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Goal> & { id: string }) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const { organization_id: _, ...safeUpdates } = updates as Partial<Goal> & { organization_id?: string };
      const { data, error } = await supabase
        .from("goals")
        .update(safeUpdates)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["team-goals"] });
      queryClient.invalidateQueries({ queryKey: ["individual-goals"] });
      toast.success("Meta atualizada com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao atualizar meta: " + error.message);
    },
  });
}
