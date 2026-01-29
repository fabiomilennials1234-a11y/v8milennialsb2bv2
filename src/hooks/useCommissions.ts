import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type Commission = Tables<"commissions">;
export type CommissionInsert = TablesInsert<"commissions">;
export type CommissionUpdate = TablesUpdate<"commissions">;

export function useCommissions(month?: number, year?: number) {
  return useQuery({
    queryKey: ["commissions", month, year],
    queryFn: async () => {
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
  });
}

export function useCommissionsByMember(teamMemberId: string, month?: number, year?: number) {
  return useQuery({
    queryKey: ["commissions", "member", teamMemberId, month, year],
    queryFn: async () => {
      let query = supabase
        .from("commissions")
        .select(`
          *,
          pipe_proposta:pipe_propostas(
            id, sale_value, product_type, closed_at,
            lead:leads(name, company)
          )
        `)
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
    enabled: !!teamMemberId,
  });
}

export function useCreateCommission() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (commission: CommissionInsert) => {
      const { data, error } = await supabase
        .from("commissions")
        .insert(commission)
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
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: CommissionUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("commissions")
        .update(updates)
        .eq("id", id)
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
  return useQuery({
    queryKey: ["commission_summary", teamMemberId, month, year],
    queryFn: async () => {
      // Get team member info
      const { data: member, error: memberError } = await supabase
        .from("team_members")
        .select("*")
        .eq("id", teamMemberId)
        .single();
      
      if (memberError) throw memberError;

      // Get closed sales for this month
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();

      const { data: sales, error: salesError } = await supabase
        .from("pipe_propostas")
        .select("sale_value, product_type, closed_at, updated_at")
        .eq("closer_id", teamMemberId)
        .eq("status", "vendido")
        // Nem sempre o closed_at está preenchido. Quando estiver null,
        // usamos updated_at (momento que normalmente foi marcado como vendido).
        .or(
          `and(closed_at.gte.${startIso},closed_at.lte.${endIso}),and(updated_at.gte.${startIso},updated_at.lte.${endIso})`
        );

      if (salesError) throw salesError;

      // Calculate totals by product type
      let totalMRR = 0;
      let totalProjeto = 0;
      const salesCount = sales?.length || 0;

      sales?.forEach(sale => {
        const value = Number(sale.sale_value) || 0;
        if (sale.product_type === "mrr") {
          totalMRR += value;
        } else if (sale.product_type === "projeto") {
          totalProjeto += value;
        }
      });

      // Calculate commissions - allow zero values
      const commissionMRRPercent = member.commission_mrr_percent != null ? Number(member.commission_mrr_percent) : 1;
      const commissionProjetoPercent = member.commission_projeto_percent != null ? Number(member.commission_projeto_percent) : 0.5;
      
      const commissionMRR = totalMRR * (commissionMRRPercent / 100);
      const commissionProjeto = totalProjeto * (commissionProjetoPercent / 100);
      const totalCommission = commissionMRR + commissionProjeto;

      // Get goal progress based on member role
      // Prefer: individual goal; fallback: team goal (team_member_id null)
      // SDR: "reunioes" based on confirmed meetings
      // Closer: prefer "vendas" (count). If not found, fallback to "clientes" (count) then "faturamento" (R$)
      let goalProgress = 0;
      let goalTarget = 0;
      let goalCurrent = 0;

      const fetchGoalTarget = async (type: string) => {
        // 1) individual goal
        const { data: individualGoal } = await supabase
          .from("goals")
          .select("target_value, created_at")
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

        // 2) team goal
        const { data: teamGoal } = await supabase
          .from("goals")
          .select("target_value, created_at")
          .is("team_member_id", null)
          .eq("month", month)
          .eq("year", year)
          .eq("type", type)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        return Number(teamGoal?.target_value) || 0;
      };

      if (member.role === "sdr") {
        // Meta de reuniões (quantidade)
        goalTarget = await fetchGoalTarget("reunioes");

        // Contar reuniões comparecidas do SDR
        const { data: confirmations } = await supabase
          .from("pipe_confirmacao")
          .select("id")
          .eq("sdr_id", teamMemberId)
          .eq("status", "compareceu")
          .gte("meeting_date", startDate.toISOString())
          .lte("meeting_date", endDate.toISOString());

        goalCurrent = confirmations?.length || 0;
        goalProgress = goalTarget > 0 ? (goalCurrent / goalTarget) * 100 : 0;
      } else {
        // Closer: tenta usar meta em ordem de prioridade
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
    enabled: !!teamMemberId,
  });
}
