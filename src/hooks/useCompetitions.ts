import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

export interface Competition {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  criteria: "absolute_value" | "goal_percentage";
  metric_type: "sales" | "meetings";
  month: number;
  year: number;
  start_date: string;
  end_date: string;
  status: "draft" | "active" | "ended";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompetitionParticipant {
  id: string;
  competition_id: string;
  team_member_id: string;
  created_at: string;
}

export interface CompetitionPrize {
  id: string;
  competition_id: string;
  position: number;
  prize_name: string;
  prize_description: string | null;
  prize_value: number | null;
  prize_icon: string;
  created_at: string;
}

export function useCompetitions(month?: number, year?: number) {
  const { organizationId } = useOrganization();
  const now = new Date();
  const m = month ?? now.getMonth() + 1;
  const y = year ?? now.getFullYear();

  return useQuery({
    queryKey: ["competitions", organizationId, m, y],
    queryFn: async (): Promise<Competition[]> => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("competitions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("month", m)
        .eq("year", y)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Competition[];
    },
    enabled: !!organizationId,
    staleTime: 60000,
  });
}

export function useActiveCompetition(month?: number, year?: number) {
  const { data: competitions } = useCompetitions(month, year);
  return competitions?.find((c) => c.status === "active") ?? null;
}

export function useCompetitionParticipants(competitionId: string | null) {
  return useQuery({
    queryKey: ["competition-participants", competitionId],
    queryFn: async (): Promise<CompetitionParticipant[]> => {
      if (!competitionId) return [];
      const { data, error } = await supabase
        .from("competition_participants")
        .select("*")
        .eq("competition_id", competitionId);
      if (error) throw error;
      return data as CompetitionParticipant[];
    },
    enabled: !!competitionId,
    staleTime: 60000,
  });
}

export function useCompetitionPrizes(competitionId: string | null) {
  return useQuery({
    queryKey: ["competition-prizes", competitionId],
    queryFn: async (): Promise<CompetitionPrize[]> => {
      if (!competitionId) return [];
      const { data, error } = await supabase
        .from("competition_prizes")
        .select("*")
        .eq("competition_id", competitionId)
        .order("position");
      if (error) throw error;
      return data as CompetitionPrize[];
    },
    enabled: !!competitionId,
    staleTime: 60000,
  });
}

export function useCreateCompetition() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      criteria: "absolute_value" | "goal_percentage";
      metric_type: "sales" | "meetings";
      month: number;
      year: number;
      start_date: string;
      end_date: string;
      status?: "draft" | "active";
      participants: string[];
      prizes: Array<{ position: number; prize_name: string; prize_description?: string; prize_value?: number; prize_icon?: string }>;
    }) => {
      if (!organizationId) throw new Error("No org");

      // Create competition
      const { data: comp, error: compError } = await supabase
        .from("competitions")
        .insert({
          organization_id: organizationId,
          name: input.name,
          description: input.description || null,
          criteria: input.criteria,
          metric_type: input.metric_type,
          month: input.month,
          year: input.year,
          start_date: input.start_date,
          end_date: input.end_date,
          status: input.status || "draft",
        })
        .select()
        .single();
      if (compError) throw compError;

      // Add participants
      if (input.participants.length > 0) {
        const { error: partError } = await supabase
          .from("competition_participants")
          .insert(input.participants.map((tmId) => ({
            competition_id: comp.id,
            team_member_id: tmId,
          })));
        if (partError) throw partError;
      }

      // Add prizes
      if (input.prizes.length > 0) {
        const { error: prizeError } = await supabase
          .from("competition_prizes")
          .insert(input.prizes.map((p) => ({
            competition_id: comp.id,
            position: p.position,
            prize_name: p.prize_name,
            prize_description: p.prize_description || null,
            prize_value: p.prize_value || null,
            prize_icon: p.prize_icon || "🏆",
          })));
        if (prizeError) throw prizeError;
      }

      return comp;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitions"] });
    },
  });
}

export function useUpdateCompetition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Competition> & { id: string }) => {
      const { data, error } = await supabase
        .from("competitions")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitions"] });
    },
  });
}

export function useEndCompetition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("competitions")
        .update({ status: "ended" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitions"] });
    },
  });
}
