import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrganization } from "./useOrganization";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

/** Intervalo do mês (dia 1 00:00 até último dia 23:59:59) para vincular metas ao mês. */
function getMonthRange(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

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
        .select("id, name, type, target_value, current_value, month, year, team_member_id, created_at, updated_at")
        .eq("organization_id", organizationId)
        .eq("month", selectedMonth)
        .eq("year", selectedYear);

      if (error) throw error;
      return data as Goal[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useTeamGoals(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("goals", ["goals", "team-goals", "individual-goals", "tv-dashboard"]);

  return useQuery({
    queryKey: ["team-goals", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data: goals, error } = await supabase
        .from("goals")
        .select("id, name, type, target_value, current_value, month, year, team_member_id, created_at, updated_at")
        .eq("organization_id", organizationId)
        .eq("month", selectedMonth)
        .eq("year", selectedYear)
        .is("team_member_id", null);

      if (error) throw error;
      return goals as Goal[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Sincroniza a meta de equipe (faturamento) com a soma das metas individuais de vendas dos closers.
 * Chamada após criar, atualizar ou excluir metas individuais de vendas.
 */
export async function syncTeamFaturamentoGoal(
  month: number,
  year: number,
  organizationId: string
): Promise<void> {
  const { data: salesMembers } = await supabase
    .from("team_members")
    .select("id, metric_type")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  const closerIds = (salesMembers ?? []).filter((m) => (m as any).metric_type === "sales").map((c) => c.id);
  if (closerIds.length === 0) return;

  const { data: vendasGoals } = await supabase
    .from("goals")
    .select("target_value")
    .eq("organization_id", organizationId)
    .eq("month", month)
    .eq("year", year)
    .eq("type", "vendas")
    .in("team_member_id", closerIds);

  const soma = (vendasGoals ?? []).reduce(
    (acc, g) => acc + Number(g.target_value || 0),
    0
  );

  const { data: existingTeamGoal } = await supabase
    .from("goals")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("month", month)
    .eq("year", year)
    .eq("type", "faturamento")
    .is("team_member_id", null)
    .maybeSingle();

  if (existingTeamGoal) {
    await supabase
      .from("goals")
      .update({
        target_value: soma,
        name: "Faturamento",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingTeamGoal.id)
      .eq("organization_id", organizationId);
  } else {
    await supabase.from("goals").insert([
      {
        organization_id: organizationId,
        name: "Faturamento",
        type: "faturamento",
        target_value: soma,
        current_value: 0,
        month,
        year,
        team_member_id: null,
      },
    ]);
  }
}

export function useIndividualGoals(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { organizationId, isReady } = useOrganization();
  const { startStr, endStr } = getMonthRange(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["individual-goals", selectedMonth, selectedYear, organizationId],
    queryFn: async () => {
      if (!organizationId) return { closerGoals: [], sdrGoals: [] } as { closerGoals: any[]; sdrGoals: any[] };
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("id, name, role, metric_type")
        .eq("organization_id", organizationId)
        .eq("is_active", true);

      const { data: goals, error } = await supabase
        .from("goals")
        .select("id, name, type, target_value, current_value, month, year, team_member_id")
        .eq("organization_id", organizationId)
        .eq("month", selectedMonth)
        .eq("year", selectedYear)
        .not("team_member_id", "is", null);

      if (error) throw error;

      // Progresso vinculado ao mês: dia 1 até último dia do mês (não pipeline inteiro)
      const [salesRes1, salesRes2, confRes1, confRes2] = await Promise.all([
        supabase
          .from("pipe_propostas")
          .select("closer_id, sale_value")
          .eq("organization_id", organizationId)
          .eq("status", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("pipe_propostas")
          .select("closer_id, sale_value")
          .eq("organization_id", organizationId)
          .eq("status", "vendido")
          .is("metrics_period_at", null)
          .gte("closed_at", startStr)
          .lte("closed_at", endStr),
        supabase
          .from("pipe_confirmacao")
          .select("sdr_id")
          .eq("organization_id", organizationId)
          .eq("status", "compareceu")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("pipe_confirmacao")
          .select("sdr_id")
          .eq("organization_id", organizationId)
          .eq("status", "compareceu")
          .is("metrics_period_at", null)
          .gte("created_at", startStr)
          .lte("created_at", endStr),
      ]);

      const salesData = [...(salesRes1.data || []), ...(salesRes2.data || [])];
      const confData = [...(confRes1.data || []), ...(confRes2.data || [])];

      const closers = teamMembers?.filter((m) => (m as any).metric_type === "sales") || [];
      const sdrs = teamMembers?.filter((m) => (m as any).metric_type === "meetings") || [];

      const closerGoals = closers.map((closer) => {
        const goal = goals?.find(
          (g) => g.team_member_id === closer.id && g.type === "vendas"
        );
        const currentValue = salesData
          .filter((s) => (s.responsible_id || s.closer_id) === closer.id)
          .reduce((sum, s) => sum + (Number(s.sale_value) || 0), 0);
        const targetValue = goal?.target_value || 0;
        return {
          id: closer.id,
          name: closer.name,
          metricType: "sales",
          current: currentValue,
          goal: targetValue,
          percentage: targetValue
            ? Math.round((currentValue / targetValue) * 100)
            : 0,
        };
      });

      const sdrGoals = sdrs.map((sdr) => {
        const goal = goals?.find(
          (g) => g.team_member_id === sdr.id && g.type === "reunioes"
        );
        const currentValue = confData.filter((c) => (c.responsible_id || c.sdr_id) === sdr.id).length;
        const targetValue = goal?.target_value || 0;
        return {
          id: sdr.id,
          name: sdr.name,
          metricType: "meetings",
          current: currentValue,
          goal: targetValue,
          percentage: targetValue
            ? Math.round((currentValue / targetValue) * 100)
            : 0,
        };
      });

      return { closerGoals, sdrGoals };
    },
    enabled: isReady && !!organizationId,
    staleTime: 2 * 60 * 1000,
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

      if (data.team_member_id && data.type === "vendas") {
        await syncTeamFaturamentoGoal(data.month, data.year, organizationId);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["team-goals"] });
      queryClient.invalidateQueries({ queryKey: ["individual-goals"] });
      queryClient.invalidateQueries({ queryKey: ["tv-dashboard"] });
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

      // Sincroniza meta de equipe em qualquer atualização de meta individual (ex: vendas→reunioes remove da soma)
      if (data.team_member_id) {
        await syncTeamFaturamentoGoal(data.month, data.year, organizationId);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["team-goals"] });
      queryClient.invalidateQueries({ queryKey: ["individual-goals"] });
      queryClient.invalidateQueries({ queryKey: ["tv-dashboard"] });
      toast.success("Meta atualizada com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao atualizar meta: " + error.message);
    },
  });
}
