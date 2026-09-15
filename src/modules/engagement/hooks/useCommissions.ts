import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useOrganization } from "@/modules/identity";
import { useFeatureFlag } from "@/modules/platform";
// Deep import do arquivo de CONTRATOS puro (só tipos + funções puras, zero grafo
// de módulo) — evita puxar o barrel inteiro de analytics (que importa hooks →
// identity) e formar ciclo de import. Mesma origem que #998 consome internamente.
import { monthPeriodArgs, type CommissionLedgerResult } from "@/modules/analytics/types/canonical-metrics";
import { resolveSalesGoalProgress } from "@/modules/engagement/lib/goal-progress";
export type Commission = Tables<"commissions">;
export type CommissionInsert = TablesInsert<"commissions">;
export type CommissionUpdate = TablesUpdate<"commissions">;

export function useCommissions(month?: number, year?: number) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["commissions", month, year, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      // source='manual': linhas projetadas de sale_events (#994, ADR-0017 §6)
      // ficam INVISÍVEIS pra esta UI até o SP-3 — os cards desta página já
      // calculam comissão on-the-fly; somar a projeção aqui dobraria o valor.
      let query = supabase
        .from("commissions")
        .select(`
          *,
          team_member:team_members(id, name, role),
          pipe_proposta:negocio_projetado(
            id, sale_value, product_type,
            lead:leads(name, company)
          )
        `)
        // O espelho já recortava o funil; num embed o recorte é este filtro.
        .eq("pipe_proposta.funil_sistema", "propostas")
        .eq("organization_id", organizationId)
        .eq("source", "manual")
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
          pipe_proposta:negocio_projetado(
            id, sale_value, product_type, closed_at,
            lead:leads(name, company)
          )
        `)
        // O espelho já recortava o funil; num embed o recorte é este filtro.
        .eq("pipe_proposta.funil_sistema", "propostas")
        .eq("organization_id", organizationId)
        .eq("team_member_id", teamMemberId)
        // Projeções de sale_events (#994) invisíveis até o SP-3 — ver useCommissions.
        .eq("source", "manual")
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

/** Lê valores apurados e pendências do caderno, com taxas preservadas na venda. */
interface CanonicalCommission {
  totalMRR: number;
  totalProjeto: number;
  commissionMRR: number;
  commissionProjeto: number;
  totalCommission: number;
  baseRevenue: number;
  saleCount: number;
  pendingCount: number;
  pendingRevenue: number;
  periodStart: string;
  periodEnd: string;
}

async function overlayCommissionLedger(
  organizationId: string,
  teamMemberId: string,
  month: number,
  year: number,
): Promise<CanonicalCommission> {
  const period = monthPeriodArgs(month, year);
  const { data, error } = await supabase.rpc("get_commission_ledger", {
    p_org_id: organizationId,
    p_period: period.p_period,
    p_ref: period.p_ref,
    p_start: period.p_start,
    p_end: period.p_end,
    p_filter_member_id: teamMemberId,
  });

  if (error) {
    throw new Error(`get_commission_ledger failed: ${error.message}`);
  }

  const raw = Array.isArray(data) ? (data.length > 0 ? data[0] : null) : data;
  const ledger = raw as (Omit<CommissionLedgerResult, "by_member"> & {
    projection_status: "ready" | "pending";
    by_member: (CommissionLedgerResult["by_member"][number] & { pending_count?: number; pending_revenue?: number })[];
  }) | null;
  if (!ledger || !["ready", "pending"].includes(ledger.projection_status)) {
    throw new Error("A apuração de comissões ainda não está disponível neste ambiente.");
  }

  // Filtrado por membro → by_member tem 0 ou 1 linha. Sem linha = sem venda
  // canônica no período (comissão 0) — coerente com "membro fora do pódio" (R5).
  const m = ledger.by_member?.find((x) => x.member_id === teamMemberId) ?? null;
  if (!m) {
    return {
      totalMRR: 0, totalProjeto: 0, commissionMRR: 0, commissionProjeto: 0,
      totalCommission: 0, baseRevenue: 0, saleCount: 0, pendingCount: 0, pendingRevenue: 0, periodStart: ledger.period.start, periodEnd: ledger.period.end,
    };
  }
  return {
    totalMRR: m.by_type.mrr.base_revenue,
    totalProjeto: m.by_type.projeto.base_revenue,
    commissionMRR: m.by_type.mrr.commission,
    commissionProjeto: m.by_type.projeto.commission,
    totalCommission: m.commission,
    baseRevenue: m.base_revenue,
    saleCount: m.sale_count,
    periodStart: ledger.period.start, periodEnd: ledger.period.end,
    pendingCount: m.pending_count ?? 0,
    pendingRevenue: m.pending_revenue ?? 0,
  };
}

// Calculate commission summary for a closer
export interface CommissionSummary {
  salesRevenue: number;
  totalMRR: number;
  totalProjeto: number;
  commissionMRR: number;
  commissionProjeto: number;
  totalCommission: number;
  oteBase: number;
  oteBonus: number;
  calculatedBonus: number;
  campaignBonuses: number;
  totalEarnings: number | null;
  commissionStatus: "ready" | "pending";
  pendingRevenue: number;
  pendingCount: number;
  goalConfigured: boolean;
  goalCurrent: number;
  goalProgress: number;
  campaignBonusList: { campaignName: string; bonusValue: number }[];
}

export function useCommissionSummary(teamMemberId: string, month: number, year: number) {
  const { organizationId, isReady } = useOrganization();
  // Dark-launch gate (U3): the canonical commission overlay runs only when the org
  // has `canonical_metrics` flipped on. Fail-closed → default is the legacy
  // on-the-fly computation (get_commission_ledger never called).
  const useCanonical = useFeatureFlag("canonical_metrics").enabled;

  return useQuery({
    queryKey: ["commission_summary", teamMemberId, month, year, organizationId, useCanonical],
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

      const canonical = useCanonical
        ? await overlayCommissionLedger(organizationId, teamMemberId, month, year)
        : null;

      // A RPC fornece os limites no fuso da organização.
      const startStr = canonical?.periodStart ?? new Date(Date.UTC(year, month - 1, 1)).toISOString();
      const endStr = canonical?.periodEnd ?? new Date(Date.UTC(year, month, 1)).toISOString();

      // Período: COALESCE(metrics_period_at, closed_at) no intervalo do mês.
      // Fase A descomissionamento (PRD #211 / Issue #214): crédito de venda
      // lê EXCLUSIVAMENTE `sale_responsible_id`. Fallback para `closer_id`
      // legacy removido — o trigger DB garante snapshot dual no momento da
      // transição para `vendido`, e backfill (`e3ac4599`) já preencheu
      // histórico onde dual era nulo.
      const [salesQ1, salesQ2] = useCanonical ? [{ data: [], error: null }, { data: [], error: null }] : await Promise.all([
        supabase
          .from("negocio_projetado")
          .select("sale_value, product_type")
          .eq("funil_sistema", "propostas")
          .eq("organization_id", organizationId)
          .eq("sale_responsible_id", teamMemberId)
          .eq("stage_key", "vendido")
          .not("metrics_period_at", "is", null)
          .gte("metrics_period_at", startStr)
          .lt("metrics_period_at", endStr),
        supabase
          .from("negocio_projetado")
          .select("sale_value, product_type")
          .eq("funil_sistema", "propostas")
          .eq("organization_id", organizationId)
          .eq("sale_responsible_id", teamMemberId)
          .eq("stage_key", "vendido")
          .is("metrics_period_at", null)
          .gte("closed_at", startStr)
          .lt("closed_at", endStr),
      ]);
      if (salesQ1.error) throw salesQ1.error;
      if (salesQ2.error) throw salesQ2.error;
      const sales = [...(salesQ1.data || []), ...(salesQ2.data || [])];

      // Calculate totals by product type (LEGADO — base de fallback)
      let totalMRR = 0;
      let totalProjeto = 0;
      let salesCount = sales?.length || 0;

      sales?.forEach(sale => {
        const value = Number(sale.sale_value) || 0;
        const type = sale.product_type ?? "mrr";
        if (type === "mrr") {
          totalMRR += value;
        } else if (type === "projeto") {
          totalProjeto += value;
        }
      });

      // Calculate commissions - allow zero values (LEGADO)
      const commissionMRRPercent = member.commission_mrr_percent != null ? Number(member.commission_mrr_percent) : 1;
      const commissionProjetoPercent = member.commission_projeto_percent != null ? Number(member.commission_projeto_percent) : 0.5;

      let commissionMRR = totalMRR * (commissionMRRPercent / 100);
      let commissionProjeto = totalProjeto * (commissionProjetoPercent / 100);
      let totalCommission = commissionMRR + commissionProjeto;

      // O caminho canônico não depende da view legada nem calcula taxas atuais.
      if (canonical) {
        totalMRR = canonical.totalMRR;
        totalProjeto = canonical.totalProjeto;
        commissionMRR = canonical.commissionMRR;
        commissionProjeto = canonical.commissionProjeto;
        totalCommission = canonical.totalCommission;
        salesCount = canonical.saleCount;
      }

      // Get goal progress based on member metric_type
      // Prefer: individual goal; fallback: team goal (team_member_id null)
      // Meetings (ex-SDR): "reunioes" based on confirmed meetings
      // Sales (ex-Closer): prefer "vendas" (count). If not found, fallback to "clientes" (count) then "faturamento" (R$)
      let goalProgress = 0;
      let goalTarget = 0;
      let goalCurrent = 0;

      const fetchGoalTarget = async (type: string) => {
        // 1) individual goal (scoped to organization)
        const { data: individualGoal, error: individualError } = await supabase
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

        if (individualError) throw individualError;
        if (individualGoal?.target_value != null) {
          return Number(individualGoal.target_value) || 0;
        }

        // 2) team goal (scoped to organization)
        const { data: teamGoal, error: teamError } = await supabase
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

        if (teamError) throw teamError;
        return Number(teamGoal?.target_value) || 0;
      };

      if ((member as any).metric_type === "meetings") {
        // Meta de reuniões realizadas — tipo novo tem precedência sobre o legado (ADR-0007)
        const realizadasTarget = await fetchGoalTarget("reunioes_realizadas");
        goalTarget = realizadasTarget > 0 ? realizadasTarget : await fetchGoalTarget("reunioes");

        // Reuniões realizadas via meeting_events (ADR-0007): evento imutável,
        // conta no período da data da reunião, crédito = snapshot do pré-vendas.
        const { data: heldEvents, error: heldError } = await supabase
          .from("meeting_events")
          .select("id, meeting_date, occurred_at")
          .eq("organization_id", organizationId)
          .eq("event_type", "meeting_held")
          .eq("pre_sale_responsible_id", teamMemberId);
        if (heldError) throw heldError;
        const start = new Date(startStr).getTime();
        const end = new Date(endStr).getTime();
        goalCurrent = (heldEvents ?? []).filter((e) => {
          const t = new Date(e.meeting_date ?? e.occurred_at).getTime();
          return t >= start && t < end;
        }).length;
        goalProgress = goalTarget > 0 ? (goalCurrent / goalTarget) * 100 : 0;
      } else {
        // Sales (ex-Closer): tenta usar meta em ordem de prioridade. O valor
        // corrente vem do MESMO número canônico que o pódio (totalMRR/totalProjeto
        // e salesCount já são canônicos quando o overlay do ledger sucedeu), via a
        // fórmula ÚNICA resolveSalesGoalProgress (mata o 3º-formula do finding #9).
        const vendasTarget = await fetchGoalTarget("vendas");
        const clientesTarget = vendasTarget > 0 ? 0 : await fetchGoalTarget("clientes");
        const faturamentoTarget = vendasTarget > 0 || clientesTarget > 0 ? 0 : await fetchGoalTarget("faturamento");

        // (target, isRevenue): "vendas" >= 500 é heurística de meta em R$; senão
        // quantidade. "clientes" = contagem; "faturamento" = R$.
        let goalIsRevenue = false;
        if (vendasTarget > 0) {
          goalTarget = vendasTarget;
          goalIsRevenue = vendasTarget >= 500;
        } else if (clientesTarget > 0) {
          goalTarget = clientesTarget;
          goalIsRevenue = false;
        } else if (faturamentoTarget > 0) {
          goalTarget = faturamentoTarget;
          goalIsRevenue = true;
        } else {
          goalTarget = 0;
          goalIsRevenue = false;
        }

        const sp = resolveSalesGoalProgress({
          goalTarget,
          goalIsRevenue,
          canonicalRevenue: canonical?.baseRevenue ?? totalMRR + totalProjeto,
          canonicalSaleCount: salesCount,
        });
        goalTarget = sp.target;
        goalCurrent = sp.current;
        goalProgress = sp.progress;
      }

      // Calculate OTE bonus
      const oteBase = Number(member.ote_base) || 0;
      const oteBonus = Number(member.ote_bonus) || 0;
      const calculatedBonus = calculateOTEBonus(goalProgress, oteBonus);

      // Fetch campaign bonuses earned by this team member for this month
      const { data: campaignBonuses, error: campaignError } = await supabase
        .from("campanha_members")
        .select(`
          bonus_earned,
          campanha:campanhas!inner(
            id, organization_id, name, bonus_value, deadline, is_active
          )
        `)
        .eq("team_member_id", teamMemberId)
        .eq("bonus_earned", true)
        .eq("campanha.organization_id", organizationId);

      if (campaignError) throw campaignError;

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
        salesRevenue: canonical?.baseRevenue ?? totalMRR + totalProjeto,
        totalMRR,
        totalProjeto,
        commissionMRR,
        commissionProjeto,
        totalCommission,
        oteBase,
        oteBonus,
        calculatedBonus,
        campaignBonuses: totalCampaignBonuses,
        commissionStatus: (canonical?.pendingCount ?? 0) > 0 ? "pending" : "ready",
        pendingCount: canonical?.pendingCount ?? 0,
        pendingRevenue: canonical?.pendingRevenue ?? 0,
        goalConfigured: goalTarget > 0,
        goalCurrent,
        totalEarnings: (canonical?.pendingCount ?? 0) > 0 || (oteBonus > 0 && goalTarget <= 0)
          ? null : oteBase + calculatedBonus + totalCommission + totalCampaignBonuses,
        goalProgress,
        campaignBonusList,
      };

      return summary;
    },
    enabled: isReady && !!organizationId && !!teamMemberId,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
