export interface SuggestedPipeline {
  name: string;
  icon: string;
  color: string;
  stages: { name: string; color: string; is_final_positive: boolean; is_final_negative: boolean }[];
}

export interface SuggestedAutomation {
  name: string;
  description: string;
  trigger_type: string;
  enabled: boolean;
}

export interface OnboardingSuggestions {
  pipelines: SuggestedPipeline[];
  automations: SuggestedAutomation[];
  profileLabel: string;
  checklistPriorities: string[];
}

interface Answers {
  perfil?: {
    sells?: string;
    segment?: string;
    avg_ticket?: string;
    monthly_volume?: string;
  };
  estrutura?: {
    team_size?: string;
    has_sdr?: boolean;
    has_closer?: boolean;
    seller_type?: string;
  };
  processo?: {
    presentation_mode?: string;
    sales_cycle?: string;
    uses_proposal?: boolean;
    schedules_meeting?: boolean;
  };
}

function getSegmentNaming(segment?: string): Record<string, string> {
  switch (segment) {
    case "industria":
    case "distribuidora":
      return { proposal: "Orçamento", won: "Pedido Fechado", meeting: "Visita" };
    case "saas":
    case "consultoria":
      return { proposal: "Proposta", won: "Vendido", meeting: "Demo" };
    case "agencia":
      return { proposal: "Escopo", won: "Fechado", meeting: "Briefing" };
    default:
      return { proposal: "Proposta", won: "Vendido", meeting: "Reunião" };
  }
}

export function generateSuggestions(answers: Answers): OnboardingSuggestions {
  const perfil = answers.perfil ?? {};
  const estrutura = answers.estrutura ?? {};
  const processo = answers.processo ?? {};
  const naming = getSegmentNaming(perfil.segment);

  const pipelines: SuggestedPipeline[] = [];
  const automations: SuggestedAutomation[] = [];
  const checklistPriorities: string[] = [];

  const hasSdr = estrutura.has_sdr === true;
  const hasCloser = estrutura.has_closer === true;
  const isWhatsappDirect = processo.presentation_mode === "whatsapp_direto";
  const usesMeeting = processo.schedules_meeting === true || processo.presentation_mode === "presencial" || processo.presentation_mode === "video_call";
  const usesProposal = processo.uses_proposal === true;
  const highVolume = perfil.monthly_volume === "50_200" || perfil.monthly_volume === "acima_200";

  // ── Pipeline Logic ──
  if (hasSdr && hasCloser) {
    pipelines.push({
      name: "Qualificação (SDR)",
      icon: "target",
      color: "#3b82f6",
      stages: [
        { name: "Novo", color: "#94a3b8", is_final_positive: false, is_final_negative: false },
        { name: "Abordado", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
        { name: "Respondeu", color: "#8b5cf6", is_final_positive: false, is_final_negative: false },
        { name: "Qualificado", color: "#22c55e", is_final_positive: true, is_final_negative: false },
        { name: "Descartado", color: "#ef4444", is_final_positive: false, is_final_negative: true },
      ],
    });
    pipelines.push({
      name: "Fechamento",
      icon: "briefcase",
      color: "#8b5cf6",
      stages: [
        { name: naming.meeting, color: "#3b82f6", is_final_positive: false, is_final_negative: false },
        { name: "Negociação", color: "#eab308", is_final_positive: false, is_final_negative: false },
        { name: naming.proposal + " Enviada", color: "#f97316", is_final_positive: false, is_final_negative: false },
        { name: "Follow-up", color: "#8b5cf6", is_final_positive: false, is_final_negative: false },
        { name: naming.won, color: "#22c55e", is_final_positive: true, is_final_negative: false },
        { name: "Perdido", color: "#ef4444", is_final_positive: false, is_final_negative: true },
      ],
    });
  } else if (isWhatsappDirect && !usesMeeting) {
    pipelines.push({
      name: "Vendas WhatsApp",
      icon: "zap",
      color: "#22c55e",
      stages: [
        { name: "Novo", color: "#94a3b8", is_final_positive: false, is_final_negative: false },
        { name: "Contato", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
        { name: "Interesse", color: "#8b5cf6", is_final_positive: false, is_final_negative: false },
        { name: naming.proposal, color: "#eab308", is_final_positive: false, is_final_negative: false },
        { name: naming.won, color: "#22c55e", is_final_positive: true, is_final_negative: false },
        { name: "Perdido", color: "#ef4444", is_final_positive: false, is_final_negative: true },
      ],
    });
  } else {
    pipelines.push({
      name: "Qualificação",
      icon: "target",
      color: "#3b82f6",
      stages: [
        { name: "Novo", color: "#94a3b8", is_final_positive: false, is_final_negative: false },
        { name: "Abordado", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
        { name: "Respondeu", color: "#8b5cf6", is_final_positive: false, is_final_negative: false },
        { name: naming.meeting + " Agendada", color: "#22c55e", is_final_positive: true, is_final_negative: false },
        { name: "Esfriou", color: "#ef4444", is_final_positive: false, is_final_negative: true },
      ],
    });
    if (usesProposal) {
      pipelines.push({
        name: "Propostas",
        icon: "kanban",
        color: "#f97316",
        stages: [
          { name: "Elaborando " + naming.proposal, color: "#eab308", is_final_positive: false, is_final_negative: false },
          { name: naming.proposal + " Enviada", color: "#f97316", is_final_positive: false, is_final_negative: false },
          { name: "Follow-up", color: "#8b5cf6", is_final_positive: false, is_final_negative: false },
          { name: naming.won, color: "#22c55e", is_final_positive: true, is_final_negative: false },
          { name: "Perdido", color: "#ef4444", is_final_positive: false, is_final_negative: true },
        ],
      });
    }
  }

  if (highVolume && hasSdr) {
    pipelines.push({
      name: "Carteira",
      icon: "heart",
      color: "#ec4899",
      stages: [
        { name: "0-3 meses", color: "#22c55e", is_final_positive: false, is_final_negative: false },
        { name: "3-6 meses", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
        { name: "6-12 meses", color: "#eab308", is_final_positive: false, is_final_negative: false },
        { name: "12+ meses", color: "#f97316", is_final_positive: false, is_final_negative: false },
      ],
    });
  }

  // ── Automation Suggestions ──
  automations.push({
    name: "Boas-vindas",
    description: "Envia mensagem de boas-vindas quando um novo lead entra",
    trigger_type: "lead_created",
    enabled: true,
  });

  if (usesMeeting || processo.schedules_meeting) {
    automations.push({
      name: "Confirmar " + naming.meeting,
      description: "Lembra o lead sobre a " + naming.meeting.toLowerCase() + " agendada",
      trigger_type: "stage_changed",
      enabled: true,
    });
  }

  if (hasSdr) {
    automations.push({
      name: "Notificar Vendedor",
      description: "Avisa o vendedor quando pré-venda qualifica um lead",
      trigger_type: "stage_changed",
      enabled: true,
    });
  }

  if (usesProposal) {
    automations.push({
      name: "Follow-up " + naming.proposal,
      description: "Envia follow-up 3 dias após envio da " + naming.proposal.toLowerCase(),
      trigger_type: "stage_changed",
      enabled: true,
    });
  }

  const longCycle = processo.sales_cycle === "mais_30_dias" || processo.sales_cycle === "ate_30_dias";
  if (longCycle) {
    automations.push({
      name: "Reengajamento",
      description: "Reengaja leads que não responderam em 7 dias",
      trigger_type: "lead_no_reply",
      enabled: false,
    });
  }

  // ── Checklist Priorities ──
  if (!isWhatsappDirect) checklistPriorities.push("whatsapp");
  else checklistPriorities.unshift("whatsapp");
  if (perfil.sells === "produto" || perfil.sells === "ambos") checklistPriorities.push("produtos");
  if (estrutura.team_size !== "sozinho") checklistPriorities.push("equipe");
  if (hasSdr) checklistPriorities.push("copilot");
  checklistPriorities.push("automacoes");

  // ── Profile Label ──
  const segmentLabels: Record<string, string> = {
    industria: "Indústria", distribuidora: "Distribuidora", representante: "Representante Comercial",
    saas: "SaaS", consultoria: "Consultoria", agencia: "Agência", educacao: "Educação", outro: "Empresa",
  };
  const segmentLabel = segmentLabels[perfil.segment ?? "outro"] ?? "Empresa";
  const modelLabel = hasSdr && hasCloser
    ? "com Pré-Venda + Vendedor"
    : hasSdr ? "com Pré-Venda" : isWhatsappDirect ? "venda direta WhatsApp" : "venda consultiva";

  return { pipelines, automations, profileLabel: `${segmentLabel} B2B — ${modelLabel}`, checklistPriorities };
}
