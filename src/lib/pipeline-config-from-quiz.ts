/**
 * Maps onboarding quiz answers to pipeline_display_config entries.
 * Ready to be called from the onboarding wizard when it's implemented.
 *
 * Usage (future):
 *   const config = generatePipelineDisplayConfig(quizAnswers);
 *   await supabase.from("pipeline_display_config").upsert(config);
 */

export interface QuizAnswers {
  perfil?: {
    sells?: "produto" | "servico" | "ambos";
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
    wants_carteira?: boolean;
  };
}

export interface PipelineDisplayConfigEntry {
  pipe_type: "whatsapp" | "confirmacao" | "propostas" | "upsell";
  display_name: string;
  is_visible: boolean;
  position: number;
}

/**
 * Segment-aware naming for the default funnels.
 */
function getDisplayNames(segment?: string, usesProposal?: boolean) {
  const base = {
    whatsapp: "Oportunidades",
    confirmacao: "Agendamentos",
    propostas: "Orçamentos",
    upsell: "Carteira",
  };

  // Industry/distributor segments use "Orçamentos"
  if (segment === "industria" || segment === "distribuidora" || segment === "representante") {
    base.propostas = "Orçamentos";
  }
  // SaaS/consultoria use "Propostas"
  else if (segment === "saas" || segment === "consultoria") {
    base.propostas = "Propostas";
  }
  // Agencies use "Escopos"
  else if (segment === "agencia") {
    base.propostas = "Escopos";
  }

  // If no formal proposal, rename to "Fechamento"
  if (usesProposal === false) {
    base.propostas = "Fechamento";
  }

  return base;
}

/**
 * Determines visibility of each default funnel based on quiz answers.
 */
function getVisibility(answers: QuizAnswers) {
  const processo = answers.processo;
  const isWhatsappDirect = processo?.presentation_mode === "whatsapp_direto";
  const scheduleMeeting = processo?.schedules_meeting;
  const wantsCarteira = processo?.wants_carteira;

  return {
    whatsapp: true, // Always visible — core funnel
    confirmacao: !isWhatsappDirect && scheduleMeeting !== false, // Hidden if no meetings
    propostas: true, // Always visible (renamed if no proposal)
    upsell: wantsCarteira === true, // Only if explicitly wants it
  };
}

/**
 * Main function: converts quiz answers into pipeline_display_config entries.
 */
export function generatePipelineDisplayConfig(answers: QuizAnswers): PipelineDisplayConfigEntry[] {
  const names = getDisplayNames(answers.perfil?.segment, answers.processo?.uses_proposal);
  const visibility = getVisibility(answers);

  const pipeTypes = ["whatsapp", "confirmacao", "propostas", "upsell"] as const;

  return pipeTypes.map((pipeType, index) => ({
    pipe_type: pipeType,
    display_name: names[pipeType],
    is_visible: visibility[pipeType],
    position: index + 1,
  }));
}

/**
 * Applies the generated config to the database.
 * Call this from the onboarding wizard's handleApplyConfig().
 */
export async function applyPipelineDisplayConfig(
  supabase: any,
  organizationId: string,
  config: PipelineDisplayConfigEntry[]
) {
  const rows = config.map((c) => ({
    organization_id: organizationId,
    pipe_type: c.pipe_type,
    display_name: c.display_name,
    is_visible: c.is_visible,
    position: c.position,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("pipeline_display_config")
    .upsert(rows, { onConflict: "organization_id,pipe_type" });

  if (error) throw error;
}
