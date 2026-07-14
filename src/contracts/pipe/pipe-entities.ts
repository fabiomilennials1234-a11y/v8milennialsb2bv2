/**
 * Contracts — entidades de pipeline compartilhadas.
 *
 * Interfaces de dados (puras, sem React/Supabase) que a interface `PipeOpsPort`
 * (owned by leads) precisa referenciar. Movê-las para contracts é o que permite
 * leads→pipelines = 0 INCLUSIVE type-only (dep-cruiser conta tipos).
 *
 * Definição CANÔNICA aqui. Os hooks de `pipelines` re-exportam (API pública
 * inalterada). Pipe rows legacy (`pipe_whatsapp` etc.) NÃO entram aqui — são
 * `Tables<...>` de `@/integrations/supabase/types`, infra compartilhada que
 * leads pode importar direto sem criar edge para pipelines.
 */

import type { PipelineType } from "./pipe-status";

export type LifecycleType = "permanent" | "temporary";
export type FunnelStatus = "draft" | "active" | "paused" | "ended";
export type FunnelTemplateType = "indicacao" | "prospeccao" | "reativacao";

export interface CustomPipeline {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  color: string;
  position: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Temporal fields
  lifecycle_type: LifecycleType;
  starts_at: string | null;
  ends_at: string | null;
  status: FunnelStatus;
  team_goal: number | null;
  individual_goal: number | null;
  bonus_value: number | null;
  bonus_description: string | null;
  objective_pipe_type: string | null;
  objective_stage_key: string | null;
  template_type: FunnelTemplateType | null;
  lead_source_config: Record<string, unknown> | null;
}

export interface CustomPipelineStage {
  id: string;
  organization_id: string;
  pipeline_id: string;
  stage_key: string;
  name: string;
  color: string | null;
  position: number;
  is_active: boolean;
  is_final_positive: boolean;
  is_final_negative: boolean;
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  target_pipe_type: string | null;
  target_stage_key: string | null;
  checklist_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomPipeEntry {
  id: string;
  organization_id: string;
  pipeline_id: string;
  lead_id: string;
  stage_id: string;
  assigned_to: string | null;
  notes: string | null;
  entered_at: string;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
  // Joins
  lead?: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
    // Qualification tiers (selected by useCustomPipeEntries; drive the board's
    // qualification filter). Optional/nullable — a lead may be unqualified.
    qualification_tier?: string | null;
    pre_qualification_tier?: string | null;
  };
  stage?: CustomPipelineStage;
  assigned_profile?: { id: string; full_name: string | null; avatar_url: string | null };
  assigned_member?: { id: string; name: string | null; profile: { id: string; full_name: string | null; avatar_url: string | null } | null };
}

export interface PipePropostaItem {
  id: string;
  pipe_proposta_id: string;
  product_id: string | null;
  quantity: number;
  unit_price: number | null;
  sale_value: number | null;
  created_at: string;
  product?: {
    id: string;
    name: string;
    type: "mrr" | "projeto";
    ticket: number | null;
    ticket_minimo: number | null;
    sku: string | null;
  };
}

export interface PipePropostaItemInsert {
  pipe_proposta_id: string;
  product_id: string | null;
  quantity?: number;
  unit_price?: number | null;
  sale_value: number | null;
}

export interface LossReason {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  category: string | null;
  is_system: boolean;
  display_order: number;
  created_at: string;
}

/**
 * Papel semântico governado de uma etapa (ADR-0017 §1, #990). Enum exclusivo
 * — ÚNICO input de etapa permitido em métricas (is_final_* é UI-only).
 */
export type StageRole =
  | "open"
  | "meeting_booked"
  | "meeting_held"
  | "won"
  | "lost";

/** Roles que o Stage Role Classifier (#991) pode sugerir — `open` = sem sugestão. */
export type SuggestableStageRole = Exclude<StageRole, "open">;

/** Origem de uma sugestão do classifier (#991). */
export type StageRoleSuggestionSource = "deterministic" | "ai" | "flag";

/** Etapa de pipeline canônico (tabela `pipeline_stages`). */
export interface PipelineStage {
  id: string;
  organization_id: string;
  pipeline_type: PipelineType;
  stage_key: string;
  name: string;
  color: string | null;
  position: number;
  is_active: boolean;
  is_final_positive: boolean;
  is_final_negative: boolean;
  stage_role: StageRole;
  // Sugestão pendente do Stage Role Classifier (#991) — won/lost aguardando
  // confirmação humana (meeting_* auto-aplicam e não persistem aqui).
  suggested_stage_role: StageRole | null;
  stage_role_suggested_at: string | null;
  stage_role_suggestion_source: StageRoleSuggestionSource | null;
  stage_role_reviewed_at: string | null;
  stage_role_reviewed_by: string | null;
  auto_move_min_days: number | null;
  auto_move_max_days: number | null;
  // Transição automática ao atingir etapa de sucesso. Destino é custom XOR
  // standard (espelha custom_pipeline_stages): target_pipeline_id/target_stage_id
  // apontam para um funil customizado; target_pipe_type/target_stage_key para
  // um pipe padrão.
  target_pipe_type: string | null;
  target_stage_key: string | null;
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  checklist_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineStageInsert {
  pipeline_type: PipelineType;
  stage_key: string;
  name: string;
  color?: string;
  position: number;
  is_final_positive?: boolean;
  is_final_negative?: boolean;
  /**
   * Papel semântico (ADR-0017 §1). Omitido → 'open' (trigger do #990 aplica o
   * mapa de sistema em seeds). won/lost aqui = escolha explícita do humano no
   * modal de etapa — confirmação permitida.
   */
  stage_role?: StageRole;
}

/** Modo de agendamento usado pelo RescheduleModal (slot do PipeOpsPort). */
export type ReschedulingMode = "schedule" | "reschedule";
