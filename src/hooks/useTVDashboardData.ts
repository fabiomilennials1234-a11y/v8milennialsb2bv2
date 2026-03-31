import { useQuery } from "@tanstack/react-query";
import { useTeamMembers, useCurrentTeamMember } from "./useTeamMembers";
import { usePipePropostas } from "./usePipePropostas";
import { usePipeConfirmacao } from "./usePipeConfirmacao";
import { usePipeWhatsapp } from "./usePipeWhatsapp";
import { useTeamGoals, useIndividualGoals } from "./useGoals";
import { useIsAdmin } from "./useUserRole";

export interface TVDashboardMetrics {
  // Sales goals
  metaVendasMes: number;
  vendasRealizadas: number;
  vendasMRR: number;
  vendasProjeto: number;
  ondeDeveriamEstar: number;
  quantoFalta: number;
  
  // Meetings
  reunioesComparecidas: number;
  
  // Conversion
  taxaConversaoGeral: number;
  conversaoPorCloser: { name: string; rate: number; sales: number; proposals: number }[];
  
  // Tickets
  ticketMedioMRR: number;
  ticketMedioProjeto: number;
  
  // No-show
  noShowGeral: number;
  noShowPorCloser: { name: string; rate: number }[];
  
  // Leads to work
  leadsParaTrabalhar: number;
  leadsRemarcar: number;
  leadsNovo: number;
  leadsAbordado: number;
  
  // Hot proposals
  propostasQuentes: any[];
  
  // Monthly sales
  vendasDoMes: any[];
  
  // Individual goals
  individualGoals: {
    closers: { name: string; id: string; current: number; goal: number; percentage: number }[];
    sdrs: { name: string; id: string; current: number; goal: number; percentage: number }[];
  };
  
  // Funnel data
  funnel: {
    reunioesMarcadas: number;
    comparecidas: number;
    marcandoR2: number;
    marcandoR2Value: number;
    r2Marcadas: number;
    r2MarcadasValue: number;
    vendido: number;
    vendidoValue: number;
  };
}

export function useTVDashboardData() {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const dayOfMonth = now.getDate();
  const lastDayOfMonth = new Date(currentYear, currentMonth, 0).getDate();
  
  const { isAdmin } = useIsAdmin();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const { data: teamMembers } = useTeamMembers();
  const { data: propostas } = usePipePropostas();
  const { data: confirmacoes } = usePipeConfirmacao();
  const { data: whatsapp } = usePipeWhatsapp();
  const { data: teamGoals } = useTeamGoals(currentMonth, currentYear);
  const { data: individualGoals } = useIndividualGoals(currentMonth, currentYear);
  
  return useQuery({
    queryKey: ["tv-dashboard", currentMonth, currentYear, isAdmin, currentTeamMember?.id, propostas, confirmacoes, whatsapp, teamGoals, individualGoals],
    queryFn: () => {
      // Dashboard da central de controle: só admin vê todos; outros veem apenas seus números
      const myId = currentTeamMember?.id ?? null;
      const propostasFiltradas = isAdmin ? (propostas ?? []) : (propostas ?? []).filter(p => (p as any).responsible_id === myId || p.closer_id === myId);
      const confirmacoesFiltradas = isAdmin ? (confirmacoes ?? []) : (confirmacoes ?? []).filter(c => (c as any).responsible_id === myId || c.sdr_id === myId);
      const whatsappFiltrado = isAdmin ? (whatsapp ?? []) : (whatsapp ?? []).filter(w => (w as any).responsible_id === myId || w.sdr_id === myId);
      
      const closers = isAdmin
        ? (teamMembers?.filter(m => (m as any).metric_type === "sales" && m.is_active) || [])
        : (currentTeamMember && (currentTeamMember as any).metric_type === "sales" ? [currentTeamMember] : []);
      const sdrs = isAdmin
        ? (teamMembers?.filter(m => (m as any).metric_type === "meetings" && m.is_active) || [])
        : (currentTeamMember && (currentTeamMember as any).metric_type === "meetings" ? [currentTeamMember] : []);
      
      // Meta: admin vê meta do time (fonte canônica); não-admin vê meta individual
      const salesGoalVendas = teamGoals?.find(g => g.type === "vendas" && !g.team_member_id);
      const salesGoalFaturamento = teamGoals?.find(g => g.type === "faturamento" || g.name.toLowerCase().includes("faturamento"));
      const salesGoal = salesGoalVendas || salesGoalFaturamento;
      const somaMetasSales =
        individualGoals?.salesGoals?.reduce((s, g) => s + (g.goal || 0), 0) ?? 0;
      const myGoal = myId && individualGoals?.salesGoals
        ? individualGoals.salesGoals.find(g => g.id === myId)
        : myId && individualGoals?.meetingsGoals
          ? individualGoals.meetingsGoals.find(g => g.id === myId)
          : null;
      const metaVendasMes = isAdmin
        ? (salesGoal?.target_value || somaMetasSales || 0)
        : (myGoal?.goal ?? 0);
      
      // Filter proposals for current month (já filtradas por usuário se não admin)
      const currentMonthPropostas = propostasFiltradas.filter(p => {
        const closedAt = p.closed_at ? new Date(p.closed_at) : null;
        return closedAt && 
          closedAt.getMonth() + 1 === currentMonth && 
          closedAt.getFullYear() === currentYear &&
          p.status === "vendido";
      }) || [];
      
      // Calculate sales values
      // vendasMRR = soma do valor mensal recorrente (sem multiplicar pela duração)
      // vendasRealizadas = Venda Total = Rec. × duração + Projeto (valor real contratado)
      let vendasMRR = 0;
      let vendasProjeto = 0;
      let vendasRealizadas = 0;
      for (const p of currentMonthPropostas) {
        // contract_duration nulo/inválido → fallback de 1 mês
        const duration = Math.max(1, Number((p as any).contract_duration) || 1);
        const items = ((p as any).items as Array<{ sale_value: number | null; product?: { type: string } | null }> | null)
          ?.filter(i => i != null) ?? [];
        if (items.length > 0) {
          for (const item of items) {
            const val = Number(item.sale_value) || 0;
            const t = item.product?.type;
            if (t === "mrr") {
              vendasMRR += val;
              vendasRealizadas += val * duration;
            } else if (t === "projeto") {
              vendasProjeto += val;
              vendasRealizadas += val;
            } else {
              vendasRealizadas += val;
            }
          }
        } else {
          const val = Number(p.sale_value) || 0;
          if (p.product_type === "mrr") {
            vendasMRR += val;
            vendasRealizadas += val * duration;
          } else if (p.product_type === "projeto") {
            vendasProjeto += val;
            vendasRealizadas += val;
          } else {
            vendasRealizadas += val;
          }
        }
      }
      
      // Where should we be (proportional to days passed)
      const progressoEsperado = dayOfMonth / lastDayOfMonth;
      const ondeDeveriamEstar = metaVendasMes * progressoEsperado;
      const quantoFalta = Math.max(0, metaVendasMes - vendasRealizadas);
      
      // Meetings attended this month
      const currentMonthConfirmacoes = confirmacoesFiltradas.filter(c => {
        const meetingDate = c.meeting_date ? new Date(c.meeting_date) : null;
        return meetingDate && 
          meetingDate.getMonth() + 1 === currentMonth && 
          meetingDate.getFullYear() === currentYear;
      });
      
      const reunioesComparecidas = currentMonthConfirmacoes.filter(c => 
        c.status === "compareceu"
      ).length;
      
      // Calculate ticket averages
      const mrrSales = currentMonthPropostas.filter(p => p.product_type === "mrr");
      const projetoSales = currentMonthPropostas.filter(p => p.product_type === "projeto");
      const ticketMedioMRR = mrrSales.length > 0 
        ? mrrSales.reduce((sum, p) => sum + (p.sale_value || 0), 0) / mrrSales.length 
        : 0;
      const ticketMedioProjeto = projetoSales.length > 0 
        ? projetoSales.reduce((sum, p) => sum + (p.sale_value || 0), 0) / projetoSales.length 
        : 0;
      
      // Conversion rate: TODOS os leads no pipe X leads na etapa vendido
      const totalNoPipe = propostasFiltradas.length;
      const totalVendido = propostasFiltradas.filter(p => p.status === "vendido").length;
      const taxaConversaoGeral = totalNoPipe > 0 ? (totalVendido / totalNoPipe) * 100 : 0;
      
      // Conversion rate per closer (também: todos no pipe do closer X vendido)
      const conversaoPorCloser = closers.map(closer => {
        const closerProposals = propostasFiltradas.filter(p => p.closer_id === closer.id);
        const closerSales = closerProposals.filter(p => p.status === "vendido").length;
        const rate = closerProposals.length > 0 ? (closerSales / closerProposals.length) * 100 : 0;
        
        return {
          name: closer.name,
          rate,
          sales: closerSales,
          proposals: closerProposals.length
        };
      });
      
      // No-show: apenas reuniões cuja data já passou (não inclui agendadas futuras)
      const finalizedConfirmacoes = currentMonthConfirmacoes.filter(c => {
        const dataJaPassou = c.meeting_date && new Date(c.meeting_date) <= now;
        return dataJaPassou && ["remarcar", "compareceu", "perdido"].includes(c.status);
      });
      const noShowCount = finalizedConfirmacoes.filter(c => 
        c.status === "remarcar" || c.status === "perdido"
      ).length;
      const noShowGeral = finalizedConfirmacoes.length > 0 
        ? (noShowCount / finalizedConfirmacoes.length) * 100 
        : 0;

      // No-show per closer
      const noShowPorCloser = closers.map(closer => {
        const closerConfirmacoes = finalizedConfirmacoes.filter(c => c.closer_id === closer.id);
        const closerNoShow = closerConfirmacoes.filter(c => 
          c.status === "remarcar" || c.status === "perdido"
        ).length;
        const rate = closerConfirmacoes.length > 0 
          ? (closerNoShow / closerConfirmacoes.length) * 100 
          : 0;

        return { name: closer.name, rate };
      });
      
      // Leads to work
      const leadsRemarcar = confirmacoesFiltradas.filter(c => c.status === "remarcar").length;
      const leadsNovo = whatsappFiltrado.filter(w => w.status === "novo").length;
      const leadsAbordado = whatsappFiltrado.filter(w => w.status === "abordado").length;
      const leadsParaTrabalhar = leadsRemarcar + leadsNovo + leadsAbordado;
      
      // Hot proposals (calor >= 7, not closed)
      const propostasQuentes = propostasFiltradas.filter(p => 
        (p.calor || 0) >= 7 &&
        !["vendido", "perdido"].includes(p.status)
      ).slice(0, 10);
      
      // Monthly sales — value = Venda Total (Rec. × duração; Projeto = pontual)
      const vendasDoMes = currentMonthPropostas.map(p => {
        const duration = Math.max(1, Number((p as any).contract_duration) || 1);
        const baseVal = p.sale_value || 0;
        const totalVal = p.product_type === "mrr" ? baseVal * duration : baseVal;
        return {
          id: p.id,
          leadName: p.lead?.name || "Lead",
          company: p.lead?.company || "",
          value: totalVal,
          type: p.product_type,
          closerName: p.closer?.name || "",
          closedAt: p.closed_at
        };
      });
      
      // ========== INDIVIDUAL GOALS - CALCULATE DYNAMICALLY ==========
      // Não-admin: só metas do próprio usuário
      const salesGoalsSource = isAdmin ? (individualGoals?.salesGoals || []) : (myId && individualGoals?.salesGoals?.find(g => g.id === myId) ? [individualGoals.salesGoals.find(g => g.id === myId)!] : []);
      const meetingsGoalsSource = isAdmin ? (individualGoals?.meetingsGoals || []) : (myId && individualGoals?.meetingsGoals?.find(g => g.id === myId) ? [individualGoals.meetingsGoals.find(g => g.id === myId)!] : []);

      const salesGoals = salesGoalsSource.map(g => {
        // Venda Total por membro = Rec. × duração + Projeto
        const memberSales = currentMonthPropostas
          .filter(p => (p.responsible_id || p.closer_id) === g.id)
          .reduce((sum, p) => {
            const duration = Math.max(1, Number((p as any).contract_duration) || 1);
            return p.product_type === "mrr"
              ? sum + (p.sale_value || 0) * duration
              : sum + (p.sale_value || 0);
          }, 0);
        const currentValue = memberSales;
        const goalValue = g.goal || 0;
        const percentage = goalValue > 0 ? Math.round((currentValue / goalValue) * 100) : 0;
        return { name: g.name, id: g.id, current: currentValue, goal: goalValue, percentage };
      });

      const meetingsGoalsCalc = meetingsGoalsSource.map(g => {
        const memberMeetings = currentMonthConfirmacoes.filter(c => (c.responsible_id || c.sdr_id) === g.id && c.status === "compareceu").length;
        const currentValue = memberMeetings;
        const goalValue = g.goal || 0;
        const percentage = goalValue > 0 ? Math.round((currentValue / goalValue) * 100) : 0;
        return { name: g.name, id: g.id, current: currentValue, goal: goalValue, percentage };
      });
      
      // ========== FUNNEL DATA ==========
      const reunioesMarcadasFunnel = confirmacoesFiltradas.length;
      const comparecidasFunnel = confirmacoesFiltradas.filter(c => c.status === "compareceu").length;
      
      const marcandoR2Propostas = propostasFiltradas.filter(p => 
        p.status === "marcar_compromisso" || p.status === "reativar"
      );
      const marcandoR2 = marcandoR2Propostas.length;
      const marcandoR2Value = marcandoR2Propostas.reduce((sum, p) => sum + (p.sale_value || 0), 0);
      
      const r2MarcadasPropostas = propostasFiltradas.filter(p => p.status === "compromisso_marcado");
      const r2Marcadas = r2MarcadasPropostas.length;
      const r2MarcadasValue = r2MarcadasPropostas.reduce((sum, p) => sum + (p.sale_value || 0), 0);
      
      // Vendido: Leads in "vendido" stage (current month)
      const vendidoFunnel = currentMonthPropostas.length;
      const vendidoValue = vendasRealizadas;
      
      return {
        metaVendasMes,
        vendasRealizadas,
        vendasMRR,
        vendasProjeto,
        ondeDeveriamEstar,
        quantoFalta,
        reunioesComparecidas,
        taxaConversaoGeral,
        conversaoPorCloser,
        ticketMedioMRR,
        ticketMedioProjeto,
        noShowGeral,
        noShowPorCloser,
        leadsParaTrabalhar,
        leadsRemarcar,
        leadsNovo,
        leadsAbordado,
        propostasQuentes,
        vendasDoMes,
        individualGoals: {
          closers: salesGoals,
          sdrs: meetingsGoalsCalc
        },
        funnel: {
          reunioesMarcadas: reunioesMarcadasFunnel,
          comparecidas: comparecidasFunnel,
          marcandoR2,
          marcandoR2Value,
          r2Marcadas,
          r2MarcadasValue,
          vendido: vendidoFunnel,
          vendidoValue
        }
      } as TVDashboardMetrics;
    },
    enabled: !!teamMembers && !!propostas && !!confirmacoes && !!whatsapp && (isAdmin !== undefined),
    staleTime: 1000 * 30, // 30 segundos — dados de TV atualizam via realtime
    refetchInterval: 1000 * 60, // Fallback: refresh a cada 60s caso realtime falhe
    refetchIntervalInBackground: false, // Parar polling quando a aba TV está em background
  });
}
