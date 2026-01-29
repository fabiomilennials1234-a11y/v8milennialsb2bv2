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
      const propostasFiltradas = isAdmin ? (propostas ?? []) : (propostas ?? []).filter(p => p.closer_id === myId);
      const confirmacoesFiltradas = isAdmin ? (confirmacoes ?? []) : (confirmacoes ?? []).filter(c => c.sdr_id === myId);
      const whatsappFiltrado = isAdmin ? (whatsapp ?? []) : (whatsapp ?? []).filter(w => w.sdr_id === myId);
      
      const closers = isAdmin
        ? (teamMembers?.filter(m => m.role === "closer" && m.is_active) || [])
        : (currentTeamMember && currentTeamMember.role === "closer" ? [currentTeamMember] : []);
      const sdrs = isAdmin
        ? (teamMembers?.filter(m => m.role === "sdr" && m.is_active) || [])
        : (currentTeamMember && currentTeamMember.role === "sdr" ? [currentTeamMember] : []);
      
      // Meta: admin vê meta da equipe; não-admin vê meta individual
      const salesGoal = teamGoals?.find(g => g.type === "faturamento" || g.name.toLowerCase().includes("faturamento"));
      const myGoal = myId && individualGoals?.closerGoals
        ? individualGoals.closerGoals.find(g => g.id === myId)
        : myId && individualGoals?.sdrGoals
          ? individualGoals.sdrGoals.find(g => g.id === myId)
          : null;
      const metaVendasMes = isAdmin ? (salesGoal?.target_value || 0) : (myGoal?.goal ?? 0);
      
      // Filter proposals for current month (já filtradas por usuário se não admin)
      const currentMonthPropostas = propostasFiltradas.filter(p => {
        const closedAt = p.closed_at ? new Date(p.closed_at) : null;
        return closedAt && 
          closedAt.getMonth() + 1 === currentMonth && 
          closedAt.getFullYear() === currentYear &&
          p.status === "vendido";
      }) || [];
      
      // Calculate sales values
      const vendasMRR = currentMonthPropostas
        .filter(p => p.product_type === "mrr")
        .reduce((sum, p) => sum + (p.sale_value || 0), 0);
      
      const vendasProjeto = currentMonthPropostas
        .filter(p => p.product_type === "projeto")
        .reduce((sum, p) => sum + (p.sale_value || 0), 0);
      
      const vendasRealizadas = vendasMRR + vendasProjeto;
      
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
      
      // Conversion rate per closer
      const conversaoPorCloser = closers.map(closer => {
        const closerProposals = propostasFiltradas.filter(p => 
          p.closer_id === closer.id &&
          new Date(p.created_at).getMonth() + 1 === currentMonth
        );
        const closerSales = closerProposals.filter(p => p.status === "vendido").length;
        const rate = closerProposals.length > 0 ? (closerSales / closerProposals.length) * 100 : 0;
        
        return {
          name: closer.name,
          rate,
          sales: closerSales,
          proposals: closerProposals.length
        };
      });
      
      // General conversion rate
      const totalPropostas = propostasFiltradas.filter(p => 
        new Date(p.created_at).getMonth() + 1 === currentMonth
      ).length;
      const totalVendas = currentMonthPropostas.length;
      const taxaConversaoGeral = totalPropostas > 0 ? (totalVendas / totalPropostas) * 100 : 0;
      
      // No-show calculation (finalized leads only)
      const finalizedConfirmacoes = currentMonthConfirmacoes.filter(c => 
        ["remarcar", "compareceu", "perdido"].includes(c.status)
      );
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
      
      // Monthly sales
      const vendasDoMes = currentMonthPropostas.map(p => ({
        id: p.id,
        leadName: p.lead?.name || "Lead",
        company: p.lead?.company || "",
        value: p.sale_value || 0,
        type: p.product_type,
        closerName: p.closer?.name || "",
        closedAt: p.closed_at
      }));
      
      // ========== INDIVIDUAL GOALS - CALCULATE DYNAMICALLY ==========
      // Não-admin: só metas do próprio usuário
      const closerGoalsSource = isAdmin ? (individualGoals?.closerGoals || []) : (myId && individualGoals?.closerGoals?.find(g => g.id === myId) ? [individualGoals.closerGoals.find(g => g.id === myId)!] : []);
      const sdrGoalsSource = isAdmin ? (individualGoals?.sdrGoals || []) : (myId && individualGoals?.sdrGoals?.find(g => g.id === myId) ? [individualGoals.sdrGoals.find(g => g.id === myId)!] : []);
      
      const closerGoals = closerGoalsSource.map(g => {
        const closerSales = currentMonthPropostas
          .filter(p => p.closer_id === g.id)
          .reduce((sum, p) => sum + (p.sale_value || 0), 0);
        const currentValue = closerSales;
        const goalValue = g.goal || 0;
        const percentage = goalValue > 0 ? Math.round((currentValue / goalValue) * 100) : 0;
        return { name: g.name, id: g.id, current: currentValue, goal: goalValue, percentage };
      });
      
      const sdrGoals = sdrGoalsSource.map(g => {
        const sdrMeetings = currentMonthConfirmacoes.filter(c => c.sdr_id === g.id && c.status === "compareceu").length;
        const currentValue = sdrMeetings;
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
          closers: closerGoals,
          sdrs: sdrGoals
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
    refetchInterval: 30000, // Refresh every 30 seconds for TV display
  });
}
