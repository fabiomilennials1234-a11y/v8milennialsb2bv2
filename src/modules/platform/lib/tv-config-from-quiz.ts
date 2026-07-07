/**
 * Maps onboarding quiz answers to TV Dashboard configuration.
 * Controls which KPIs, blocks, and labels appear on the TV.
 * Keeps all conditional logic out of the TVDashboard component.
 */

import type { OnboardingAnswers } from "@/modules/platform/hooks/useOnboarding";

// ── Types ──────────────────────────────────────────────────

export interface TVKpi {
  key: string;
  label: string;
  color: "blue" | "emerald" | "amber" | "red" | "purple" | "orange";
}

export interface TVConfig {
  kpis: TVKpi[];
  showFunnel: boolean;
  showHotProposals: boolean;
  showMonthlySales: boolean;
  showRanking: boolean;
  showIndividualGoals: boolean;
  showCarteira: boolean;
  salesLabel: string;
  proposalLabel: string;
  funnelLabel: string;
}

// ── KPI Pool ───────────────────────────────────────────────

const KPI_REUNIOES: TVKpi = { key: "reunioes", label: "Reuniões", color: "blue" };
const KPI_CONVERSAO: TVKpi = { key: "conversao", label: "Conversão", color: "emerald" };
const KPI_NOSHOW: TVKpi = { key: "noshow", label: "No-Show", color: "red" };
// FIX-C (code review): as keys `ticket_mrr`/`ticket_proj` são load-bearing (switch
// no TVDashboard + saída do useTVKPIs) e NÃO mudam. Mas o NÚMERO alimentado nelas é
// o ticket por STREAM canônico (novo_negocio|carteira), não por product_type
// (recorrência|projeto). Rótulo humano corrigido pro stream real — número certo sob
// label certo. Ver useTVKPIs.ts (streamTicket sobre revenue_by_stream).
const KPI_TICKET_MRR: TVKpi = { key: "ticket_mrr", label: "Ticket Médio Novo Negócio", color: "purple" };
const KPI_TICKET_PROJ: TVKpi = { key: "ticket_proj", label: "Ticket Médio Carteira", color: "amber" };
const KPI_LEADS: TVKpi = { key: "leads", label: "Leads p/ Trabalhar", color: "orange" };
const KPI_LEADS_NOVOS: TVKpi = { key: "leads_novos", label: "Leads Novos", color: "blue" };
const KPI_PROPOSTAS: TVKpi = { key: "propostas", label: "Propostas Enviadas", color: "purple" };
// Fix #23 (SP-0): "Base Ativa" era placeholder hardcoded 0 em useTVKPIs — removido
// do pool de KPIs até SP-3 ligar a métrica real de carteira. Nunca exibir 0 como dado.
// "Respostas" media na verdade o stage "abordado" do kanban, NÃO respostas reais de
// conversation_messages — rotulado honestamente como "Leads Abordados" até SP-3.
const KPI_RESPOSTAS: TVKpi = { key: "respostas", label: "Leads Abordados", color: "blue" };

// ── Default Config ─────────────────────────────────────────

const DEFAULT_CONFIG: TVConfig = {
  kpis: [KPI_REUNIOES, KPI_CONVERSAO, KPI_NOSHOW, KPI_TICKET_MRR, KPI_TICKET_PROJ, KPI_LEADS],
  showFunnel: true,
  showHotProposals: true,
  showMonthlySales: true,
  showRanking: true,
  showIndividualGoals: true,
  showCarteira: false,
  salesLabel: "Vendas",
  proposalLabel: "Propostas",
  funnelLabel: "Funil de Vendas",
};

// ── Generator ──────────────────────────────────────────────

export function generateTVConfig(answers?: OnboardingAnswers | null): TVConfig {
  if (!answers) return DEFAULT_CONFIG;

  const perfil = answers.perfil;
  const estrutura = answers.estrutura;
  const processo = answers.processo;

  const hasSdr = estrutura?.has_sdr === true;
  const schedulesMeeting = processo?.schedules_meeting !== false;
  const isWhatsappDirect = processo?.presentation_mode === "whatsapp_direto";
  const usesProposal = processo?.uses_proposal !== false;
  const wantsCarteira = processo?.wants_carteira === true;
  const segment = perfil?.segment;

  // ── Build KPIs ──
  const kpis: TVKpi[] = [];

  if (hasSdr && schedulesMeeting) {
    kpis.push(KPI_REUNIOES);
    kpis.push(KPI_NOSHOW);
  } else if (isWhatsappDirect) {
    kpis.push(KPI_LEADS_NOVOS);
    kpis.push(KPI_RESPOSTAS);
  } else {
    kpis.push(KPI_REUNIOES);
  }

  kpis.push(KPI_CONVERSAO);

  if (usesProposal) {
    kpis.push(KPI_PROPOSTAS);
  }

  kpis.push(KPI_TICKET_MRR);

  // Fix #23 (SP-0): carteira orgs recebiam "Base Ativa" (placeholder hardcoded 0).
  // Até SP-3 ligar a métrica real, mostrar "Leads p/ Trabalhar" (dado real) pra todos.
  kpis.push(KPI_LEADS);

  // Fill up to 6 KPIs if we have less
  const fallbackPool = [KPI_TICKET_PROJ, KPI_LEADS, KPI_PROPOSTAS, KPI_LEADS_NOVOS, KPI_REUNIOES, KPI_NOSHOW, KPI_RESPOSTAS];
  for (const fallback of fallbackPool) {
    if (kpis.length >= 6) break;
    if (!kpis.some(k => k.key === fallback.key)) {
      kpis.push(fallback);
    }
  }

  // ── Build Blocks ──
  const showFunnel = !isWhatsappDirect && schedulesMeeting;
  const showHotProposals = usesProposal;

  // ── Labels ──
  let proposalLabel = "Propostas";
  if (segment === "industria" || segment === "distribuidora" || segment === "representante") {
    proposalLabel = "Orçamentos";
  } else if (segment === "agencia") {
    proposalLabel = "Escopos";
  }
  if (!usesProposal) {
    proposalLabel = "Fechamentos";
  }

  let funnelLabel = "Funil de Vendas";
  if (isWhatsappDirect) {
    funnelLabel = "Pipeline";
  }

  return {
    kpis: kpis.slice(0, 6),
    showFunnel,
    showHotProposals,
    showMonthlySales: true,
    showRanking: true,
    showIndividualGoals: true,
    showCarteira: wantsCarteira,
    salesLabel: "Vendas",
    proposalLabel,
    funnelLabel,
  };
}
