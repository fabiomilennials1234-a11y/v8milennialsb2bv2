import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";

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
    staleTime: 5 * 60 * 1000,
  });
}

export function useTeamGoals(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("goals", ["goals", "team-goals", "individual-goals"]);

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
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Sincroniza a meta de equipe (faturamento) com a soma das metas individuais de vendas
 * dos membros com metric_type='sales'. Chamada após criar, atualizar ou excluir metas individuais de vendas.
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
      if (!organizationId) return { salesGoals: [], meetingsGoals: [] } as { salesGoals: any[]; meetingsGoals: any[] };
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
          .from("negocio_projetado")
          .select("sale_responsible_id, responsible_id, closer_id, sale_value")
          .eq("funil_sistema", "propostas")
          .eq("organization_id", organizationId)
          .eq("stage_key", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("sale_responsible_id, responsible_id, closer_id, sale_value")
          .eq("funil_sistema", "propostas")
          .eq("organization_id", organizationId)
          .eq("stage_key", "vendido")
          .is("metrics_period_at", null)
          .gte("closed_at", startStr)
          .lte("closed_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("pre_sale_responsible_id, responsible_id, sdr_id, closer_id")
          .eq("funil_sistema", "confirmacao")
          .eq("organization_id", organizationId)
          .eq("stage_key", "compareceu")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("pre_sale_responsible_id, responsible_id, sdr_id, closer_id")
          .eq("funil_sistema", "confirmacao")
          .eq("organization_id", organizationId)
          .eq("stage_key", "compareceu")
          .is("metrics_period_at", null)
          .gte("created_at", startStr)
          .lte("created_at", endStr),
      ]);

      const salesData = [...(salesRes1.data || []), ...(salesRes2.data || [])];
      const confData = [...(confRes1.data || []), ...(confRes2.data || [])];

      const salesMembers = teamMembers?.filter((m) => (m as any).metric_type === "sales") || [];
      const meetingsMembers = teamMembers?.filter((m) => (m as any).metric_type === "meetings") || [];

      const salesGoals = salesMembers.map((member) => {
        const goal = goals?.find(
          (g) => g.team_member_id === member.id && g.type === "vendas"
        );
        const currentValue = salesData
          .filter((s) => (s.sale_responsible_id || s.responsible_id || s.closer_id) === member.id)
          .reduce((sum, s) => sum + (Number(s.sale_value) || 0), 0);
        const targetValue = goal?.target_value || 0;
        return {
          id: member.id,
          name: member.name,
          metricType: "sales",
          current: currentValue,
          goal: targetValue,
          percentage: targetValue
            ? Math.round((currentValue / targetValue) * 100)
            : 0,
        };
      });

      const meetingsGoals = meetingsMembers.map((member) => {
        const goal = goals?.find(
          (g) => g.team_member_id === member.id && g.type === "reunioes"
        );
        // Crédito de comparecimento é exclusivo do SDR:
        // COALESCE(pre_sale_responsible_id, sdr_id). NÃO usar responsible_id
        // como fallback — em muitas orgs ele é populado com o closer e
        // creditaria o time errado.
        const currentValue = confData.filter((c) => (c.pre_sale_responsible_id || c.sdr_id) === member.id).length;
        const targetValue = goal?.target_value || 0;
        return {
          id: member.id,
          name: member.name,
          metricType: "meetings",
          current: currentValue,
          goal: targetValue,
          percentage: targetValue
            ? Math.round((currentValue / targetValue) * 100)
            : 0,
        };
      });

      return { salesGoals, meetingsGoals };
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
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
