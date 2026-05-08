import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useOrganization } from "./useOrganization";

export type Commission = Tables<"commissions">;
export type CommissionInsert = TablesInsert<"commissions">;
export type CommissionUpdate = TablesUpdate<"commissions">;

export function useCommissions(month?: number, year?: number) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["commissions", month, year, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      let query = supabase
        .from("commissions")
        .select(`
          *,
          team_member:team_members(id, name, role),
          pipe_proposta:pipe_propostas(
            id, sale_value, product_type,
            lead:leads(name, company)
          )
        `)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (month !== undefined) {
        query = query.eq("month", month);
      }
      if (year !== undefined) {
        query = query.eq("year", year);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: isReady && !!organizationId,
  });
}

export function useCommissionsByMember(teamMemberId: string, month?: number, year?: number) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["commissions", "member", teamMemberId, month, year, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      let query = supabase
        .from("commissions")
        .select(`
          *,
          pipe_proposta:pipe_propostas(
            id, sale_value, product_type, closed_at,
            lead:leads(name, company)
          )
        `)
        .eq("organization_id", organizationId)
        .eq("team_member_id", teamMemberId)
        .order("created_at", { ascending: false });

      if (month !== undefined) {
        query = query.eq("month", month);
      }
      if (year !== undefined) {
        query = query.eq("year", year);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: isReady && !!organizationId && !!teamMemberId,
  });
}

export function useCreateCommission() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (commission: CommissionInsert) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const secured = { ...commission, organization_id: organizationId };
      const { data, error } = await supabase
        .from("commissions")
        .insert(secured)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
    },
  });
}

export function useUpdateCommission() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: CommissionUpdate & { id: string }) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const { organization_id: _, ...safeUpdates } = updates as CommissionUpdate & { organization_id?: string };
      const { data, error } = await supabase
        .from("commissions")
        .update(safeUpdates)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
    },
  });
}

// Calculate OTE bonus based on goal progress
export function calculateOTEBonus(
  goalProgress: number, // 0-100+ percentage
  oteBonus: number
): number {
  if (goalProgress < 70) return 0;
  if (goalProgress < 100) return oteBonus * 0.7;
  if (goalProgress < 120) return oteBonus;
  return oteBonus * 1.2;
}

// Calculate commission summary for a closer
export interface CommissionSummary {
  totalMRR: number;
  totalProjeto: number;
  commissionMRR: number;
  commissionProjeto: number;
  totalCommission: number;
  oteBase: number;
  oteBonus: number;
  calculatedBonus: number;
  campaignBonuses: number;
  totalEarnings: number;
  goalProgress: number;
  campaignBonusList: { campaignName: string; bonusValue: number }[];
}

export function useCommissionSummary(teamMemberId: string, month: number, year: number) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["commission_summary", teamMemberId, month, year, organizationId],
    queryFn: async () => {
      if (!organizationId) throw new Error("Organização não disponível");

      // Get team member info (scoped to organization)
      const { data: member, error: memberError } = await supabase
        .from("team_members")
        .select("*")
        .eq("id", teamMemberId)
        .eq("organization_id", organizationId)
        .single();

      if (memberError) throw memberError;

      // Intervalo do mês em UTC (alinhado ao dashboard)
      const startStr = new Date(Date.UTC(year, month - 1, 1)).toISOString();
      const endStr = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString();

      // Período: COALESCE(metrics_period_at, closed_at) no intervalo do mês
      const [salesQ1, salesQ2] = await Promise.all([
        supabase
          .from("pipe_propostas")
          .select("sale_value, product_type")
          .eq("organization_id", organizationId)
          .or(`sale_responsible_id.eq.${teamMemberId},closer_id.eq.${teamMemberId}`)
          .eq("status", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lte("metrics_period_at", endStr),
        supabase
          .from("pipe_propostas")
          .select("sale_value, product_type")
          .eq("organization_id", organizationId)
          .or(`sale_responsible_id.eq.${teamMemberId},closer_id.eq.${teamMemberId}`)
          .eq("status", "vendido")
          .is("metrics_period_at", null)
          .gte("closed_at", startStr)
          .lte("closed_at", endStr),
      ]);
      if (salesQ1.error) throw salesQ1.error;
      if (salesQ2.error) throw salesQ2.error;
      const sales = [...(salesQ1.data || []), ...(salesQ2.data || [])];

      // Calculate totals by product type
      let totalMRR = 0;
      let totalProjeto = 0;
      const salesCount = sales?.length || 0;

      sales?.forEach(sale => {
        const value = Number(sale.sale_value) || 0;
        const type = sale.product_type ?? "mrr";
        if (type === "mrr") {
          totalMRR += value;
        } else if (type === "projeto") {
          totalProjeto += value;
        }
      });

      // Calculate commissions - allow zero values
      const commissionMRRPercent = member.commission_mrr_percent != null ? Number(member.commission_mrr_percent) : 1;
      const commissionProjetoPercent = member.commission_projeto_percent != null ? Number(member.commission_projeto_percent) : 0.5;
      
      const commissionMRR = totalMRR * (commissionMRRPercent / 100);
      const commissionProjeto = totalProjeto * (commissionProjetoPercent / 100);
      const totalCommission = commissionMRR + commissionProjeto;

      // Get goal progress based on member metric_type
      // Prefer: individual goal; fallback: team goal (team_member_id null)
      // Meetings (ex-SDR): "reunioes" based on confirmed meetings
      // Sales (ex-Closer): prefer "vendas" (count). If not found, fallback to "clientes" (count) then "faturamento" (R$)
      let goalProgress = 0;
      let goalTarget = 0;
      let goalCurrent = 0;

      const fetchGoalTarget = async (type: string) => {
        // 1) individual goal (scoped to organization)
        const { data: individualGoal } = await supabase
          .from("goals")
          .select("target_value, created_at")
          .eq("organization_id", organizationId)
          .eq("team_member_id", teamMemberId)
          .eq("month", month)
          .eq("year", year)
          .eq("type", type)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (individualGoal?.target_value != null) {
          return Number(individualGoal.target_value) || 0;
        }

        // 2) team goal (scoped to organization)
        const { data: teamGoal } = await supabase
          .from("goals")
          .select("target_value, created_at")
          .eq("organization_id", organizationId)
          .is("team_member_id", null)
          .eq("month", month)
          .eq("year", year)
          .eq("type", type)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        return Number(teamGoal?.target_value) || 0;
      };

      if ((member as any).metric_type === "meetings") {
        // Meta de reuniões (quantidade)
        goalTarget = await fetchGoalTarget("reunioes");

        // Contar reuniões comparecidas do SDR: COALESCE(metrics_period_at, created_at) no intervalo (alinhado ao dashboard)
        const [confQ1, confQ2] = await Promise.all([
          supabase
            .from("pipe_confirmacao")
            .select("id")
            .eq("organization_id", organizationId)
            .or(`pre_sale_responsible_id.eq.${teamMemberId},sdr_id.eq.${teamMemberId}`)
            .eq("status", "compareceu")
            .not("metrics_period_at", "is", null)
            .gte("metrics_period_at", startStr)
            .lte("metrics_period_at", endStr),
          supabase
            .from("pipe_confirmacao")
            .select("id")
            .eq("organization_id", organizationId)
            .or(`pre_sale_responsible_id.eq.${teamMemberId},sdr_id.eq.${teamMemberId}`)
            .eq("status", "compareceu")
            .is("metrics_period_at", null)
            .gte("created_at", startStr)
            .lte("created_at", endStr),
        ]);
        const confirmations = [...(confQ1.data || []), ...(confQ2.data || [])];
        goalCurrent = confirmations?.length || 0;
        goalProgress = goalTarget > 0 ? (goalCurrent / goalTarget) * 100 : 0;
      } else {
        // Sales (ex-Closer): tenta usar meta em ordem de prioridade
        const vendasTarget = await fetchGoalTarget("vendas");
        const clientesTarget = vendasTarget > 0 ? 0 : await fetchGoalTarget("clientes");
        const faturamentoTarget = vendasTarget > 0 || clientesTarget > 0 ? 0 : await fetchGoalTarget("faturamento");

        if (vendasTarget > 0) {
          goalTarget = vendasTarget;

          // Heurística: se a meta de "vendas" for muito alta, ela normalmente
          // está sendo usada como meta de faturamento (R$) e não quantidade.
          // Ex: "10k em vendas".
          if (vendasTarget >= 500) {
            goalCurrent = totalMRR + totalProjeto;
          } else {
            goalCurrent = salesCount;
          }
        } else if (clientesTarget > 0) {
          goalTarget = clientesTarget;
          goalCurrent = salesCount;
        } else if (faturamentoTarget > 0) {
          goalTarget = faturamentoTarget;
          goalCurrent = totalMRR + totalProjeto;
        } else {
          goalTarget = 0;
          goalCurrent = salesCount;
        }

        goalProgress = goalTarget > 0 ? (goalCurrent / goalTarget) * 100 : 0;
      }

      // Calculate OTE bonus
      const oteBase = Number(member.ote_base) || 0;
      const oteBonus = Number(member.ote_bonus) || 0;
      const calculatedBonus = calculateOTEBonus(goalProgress, oteBonus);

      // Fetch campaign bonuses earned by this team member for this month
      const { data: campaignBonuses } = await supabase
        .from("campanha_members")
        .select(`
          bonus_earned,
          campanha:campanhas(
            id, name, bonus_value, deadline, is_active
          )
        `)
        .eq("team_member_id", teamMemberId)
        .eq("bonus_earned", true);

      // Filter bonuses for campaigns that ended in the selected month
      const campaignBonusList: { campaignName: string; bonusValue: number }[] = [];
      let totalCampaignBonuses = 0;

      campaignBonuses?.forEach((cb: any) => {
        if (cb.campanha && cb.campanha.bonus_value) {
          const deadline = new Date(cb.campanha.deadline);
          // Check if campaign deadline is in the selected month/year
          if (deadline.getMonth() + 1 === month && deadline.getFullYear() === year) {
            const bonusValue = Number(cb.campanha.bonus_value) || 0;
            totalCampaignBonuses += bonusValue;
            campaignBonusList.push({
              campaignName: cb.campanha.name,
              bonusValue: bonusValue,
            });
          }
        }
      });

      const summary: CommissionSummary = {
        totalMRR,
        totalProjeto,
        commissionMRR,
        commissionProjeto,
        totalCommission,
        oteBase,
        oteBonus,
        calculatedBonus,
        campaignBonuses: totalCampaignBonuses,
        totalEarnings: oteBase + calculatedBonus + totalCommission + totalCampaignBonuses,
        goalProgress,
        campaignBonusList,
      };

      return summary;
    },
    enabled: isReady && !!organizationId && !!teamMemberId,
  });
}
