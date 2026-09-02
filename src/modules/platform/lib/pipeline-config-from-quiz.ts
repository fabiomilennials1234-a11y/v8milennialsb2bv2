/**
 * Traduz as respostas do quiz de onboarding no plano de funis de sistema da
 * org e o aplica pelo caminho CANÔNICO (`enable_system_pipeline`, que registra,
 * espelha em `pipelines` e semeia etapas server-side — SCRUM-618/635).
 *
 * Uso (OnboardingWizard.handleApplyConfig):
 *   const config = generatePipelineDisplayConfig(quizAnswers);
 *   await applyPipelineDisplayConfig(supabase, organizationId, config);
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
 * Aplica a configuração do quiz — CAMINHO CANÔNICO (SCRUM-635, W4).
 *
 * Antes: upsert de linhas em `pipeline_display_config` por tipo — criava o
 * REGISTRO mas nenhum funil de fato (nem linha em `pipelines`, nem etapa), e
 * inventava linha `is_visible=false` para funil que a org nunca teve.
 *
 * Agora cada funil visível NASCE pela RPC `enable_system_pipeline` (registro +
 * espelho em `pipelines` + etapas semeadas server-side, SCRUM-618). O batismo
 * do quiz (display_name/position) entra por UPDATE depois — a RPC preserva
 * nome personalizado de propósito. Funil não-visível NÃO é criado: linha
 * ausente = "a org não tem este funil" (20270902000000); se já existir, só é
 * ocultado.
 */
export async function applyPipelineDisplayConfig(
  supabase: any,
  organizationId: string,
  config: PipelineDisplayConfigEntry[]
) {
  for (const c of config) {
    if (c.is_visible) {
      const { error } = await supabase.rpc("enable_system_pipeline", {
        p_org_id: organizationId,
        p_pipe_type: c.pipe_type,
      });
      if (error) throw error;

      const { error: renameError } = await supabase
        .from("pipeline_display_config")
        .update({
          display_name: c.display_name,
          position: c.position,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId)
        .eq("pipe_type", c.pipe_type);
      if (renameError) throw renameError;
    } else {
      // UPDATE puro: não casa com nada quando a org nunca teve o funil — que
      // é exatamente o estado desejado (nenhuma linha fantasma).
      const { error } = await supabase
        .from("pipeline_display_config")
        .update({ is_visible: false, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("pipe_type", c.pipe_type);
      if (error) throw error;
    }
  }
}
