import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { useOrganization } from "@/modules/identity";
import { triggerFollowUpAutomation } from "@/modules/workflows/hooks/useAutoFollowUp";
import { publishEvent } from "@/integrations/supabase/events";
import { assertPermission } from "@/modules/identity";
import { useCanDo } from "@/modules/identity";
// Tipos para os objetivos de campanha
export type CampaignObjective = 'qualificacao' | 'agendamentos' | 'propostas' | 'livre';

/** @deprecated Formato LEGADO persistido em `campanhas.free_target_pipe` —
 *  aceito na leitura pra sempre (o resolvedor de funil entende o alias
 *  `pipe_*`). Código novo usa `target_pipeline_id`/`target_stage_id`. */
export type TargetPipe = 'pipe_whatsapp' | 'pipe_confirmacao' | 'pipe_propostas';

/**
 * Mapa LEGADO objetivo→destino (Fatia B): só serve de fallback de leitura para
 * campanha antiga sem `target_pipeline_id` (a migration 20270917000000
 * backfillou as resolvíveis). `pipeline` é slug (o resolvedor aceita
 * id/slug/alias); `stage` é stage_key.
 */
export const OBJECTIVE_TARGET_MAP: Record<Exclude<CampaignObjective, 'livre'>, { pipeline: string; stage: string }> = {
  qualificacao: { pipeline: 'whatsapp', stage: 'novo' },
  agendamentos: { pipeline: 'confirmacao', stage: 'reuniao_marcada' },
  propostas:    { pipeline: 'propostas', stage: 'marcar_compromisso' },
};

export const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  qualificacao: 'Qualificação',
  agendamentos: 'Agendamentos',
  propostas: 'Propostas',
  livre: 'Livre',
};

// SCRUM-641: as descrições não citam mais nome de funil — a org chama os
// funis do jeito dela (o destino real vem de OBJECTIVE_TARGET_MAP/target_pipeline_id).
export const OBJECTIVE_DESCRIPTIONS: Record<CampaignObjective, string> = {
  qualificacao: 'Qualificar leads novos',
  agendamentos: 'Agendar reuniões com os leads',
  propostas: 'Enviar propostas e fechar',
  livre: 'Objetivo customizado → Você configura',
};

/** Label da métrica principal de cada objetivo (ex.: "reuniões", "qualificações") */
export const OBJECTIVE_METRIC_LABELS: Record<CampaignObjective, string> = {
  qualificacao: 'qualificações',
  agendamentos: 'reuniões',
  propostas: 'propostas',
  livre: 'conclusões',
};

/** Label da etapa de sucesso no Kanban (checkbox) por objetivo */
export const OBJECTIVE_SUCCESS_STAGE_LABELS: Record<CampaignObjective, string> = {
  qualificacao: 'Etapa de Qualificação',
  agendamentos: 'Reunião Marcada',
  propostas: 'Etapa de Proposta',
  livre: 'Etapa de Sucesso',
};

/**
 * Retorna o label da métrica para uma campanha, com fallback seguro para campanhas legadas.
 * Campanhas criadas antes desta alteração podem não ter `objective` definido — nesse caso,
 * assume-se "reuniões" para manter compatibilidade.
 */
export function getObjectiveMetricLabel(objective: CampaignObjective | null | undefined): string {
  if (!objective) return 'reuniões'; // fallback legado
  return OBJECTIVE_METRIC_LABELS[objective] ?? 'reuniões';
}

export function getObjectiveSuccessStageLabel(objective: CampaignObjective | null | undefined): string {
  if (!objective) return 'Reunião Marcada'; // fallback legado
  return OBJECTIVE_SUCCESS_STAGE_LABELS[objective] ?? 'Reunião Marcada';
}

export const OBJECTIVE_DEFAULT_STAGES: Record<CampaignObjective, string[]> = {
  qualificacao: ['Novo', 'Contatado', 'Interessado', 'Qualificado'],
  agendamentos: ['Novo', 'Contatado', 'Agendamento Marcado'],
  propostas: ['Novo', 'Contatado', 'Proposta Enviada', 'Negociação'],
  livre: ['Novo', 'Em Progresso', 'Concluído'],
};

// Tipos para os modos de campanha
export type CampaignType = 'automatica' | 'semi_automatica' | 'manual';

export interface AutoConfig {
  delay_minutes?: number;
  send_on_add_lead?: boolean;
  working_hours_only?: boolean;
  working_hours?: {
    start: string; // formato "HH:MM"
    end: string;   // formato "HH:MM"
  };
}

export type LeadDistributionMode = "random" | "round_robin" | "single" | null;

export interface Campanha {
  id: string;
  name: string;
  description: string | null;
  deadline: string;
  team_goal: number;
  individual_goal: number | null;
  bonus_value: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Objetivo estratégico da campanha
  objective: CampaignObjective;
  free_target_pipe: TargetPipe | null;
  free_target_stage: string | null;
  // Destino canônico da extração (Fatia B): QUALQUER funil da org por
  // (pipeline_id, stage_id). NULL = resolver pelo formato legado acima.
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  // Campos dos modos de campanha
  campaign_type: CampaignType;
  agent_id: string | null;
  auto_config: AutoConfig | null;
  // Distribuição de leads (importação, Meta Ads, integrações)
  lead_distribution_mode: LeadDistributionMode;
  lead_assigned_to: string | null;
  // Investimento para métricas MKT (manual ou API)
  investimento_cents: number | null;
  investimento_updated_at: string | null;
  investimento_source: "manual" | "api" | null;
  // Quais leads da campanha contam para Marketing Call / Cadastro (por origem ou etiqueta)
  mkt_call_origins: string[] | null;
  mkt_call_tag_ids: string[] | null;
  mkt_cadastro_origins: string[] | null;
  mkt_cadastro_tag_ids: string[] | null;
  // Tipo de marketing: incluir em Call e/ou Cadastro (qual(is) dashboard(s) mostrar)
  mkt_incluir_call: boolean | null;
  mkt_incluir_cadastro: boolean | null;
  // Campanha vinculada ao marketing (aparece na divisão e pode ser configurada)
  mkt_ativo: boolean | null;
  // Investimento por tipo (Call e Cadastro) em centavos
  mkt_investimento_call_cents: number | null;
  mkt_investimento_cadastro_cents: number | null;
  // Instância WhatsApp para disparos (semi e automática)
  whatsapp_instance_id: string | null;
  // Distribuição de Closers (independente da SDR)
  closer_distribution_mode: LeadDistributionMode;
  closer_assigned_to: string | null;
}

export interface CampanhaStage {
  id: string;
  campanha_id: string;
  name: string;
  color: string | null;
  position: number;
  is_reuniao_marcada: boolean;
  created_at: string;
}

export type CampanhaMemberRole = "sdr" | "closer";

export interface CampanhaMember {
  id: string;
  campanha_id: string;
  team_member_id: string;
  role: CampanhaMemberRole;
  meetings_count: number;
  bonus_earned: boolean;
  created_at: string;
  team_member?: {
    id: string;
    name: string;
    role: string;
  };
}

export interface CampanhaLead {
  id: string;
  campanha_id: string;
  lead_id: string;
  stage_id: string;
  responsible_id: string | null;
  sdr_id: string | null;
  closer_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  lead?: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
    faturamento: string | null;
    segment: string | null;
    origin: string;
    notes: string | null;
    responsible_id: string | null;
    closer_id: string | null;
    responsible?: {
      id: string;
      name: string;
    };
    closer?: {
      id: string;
      name: string;
    };
    lead_tags?: Array<{
      tag: {
        id: string;
        name: string;
        color: string | null;
      };
    }>;
  };
  responsible?: {
    id: string;
    name: string;
  };
  sdr?: {
    id: string;
    name: string;
  };
  closer?: {
    id: string;
    name: string;
  };
  stage?: CampanhaStage;
}

export interface CampanhaInsert {
  name: string;
  description?: string | null;
  deadline: string;
  team_goal: number;
  individual_goal?: number | null;
  bonus_value?: number | null;
  // Objetivo estratégico da campanha
  objective?: CampaignObjective;
  free_target_pipe?: TargetPipe | null;
  free_target_stage?: string | null;
  // Destino canônico (Fatia B) — qualquer funil por (pipeline_id, stage_id)
  target_pipeline_id?: string | null;
  target_stage_id?: string | null;
  // Campos dos modos de campanha
  campaign_type?: CampaignType;
  agent_id?: string | null;
  auto_config?: AutoConfig | null;
  // Distribuição de leads (SDR)
  lead_distribution_mode?: LeadDistributionMode;
  lead_assigned_to?: string | null;
  // Distribuição de Closers
  closer_distribution_mode?: LeadDistributionMode;
  closer_assigned_to?: string | null;
  // Investimento MKT
  investimento_cents?: number | null;
  investimento_source?: "manual" | "api" | null;
  // Instância WhatsApp para disparos
  whatsapp_instance_id?: string | null;
}

export interface CampanhaStageInsert {
  campanha_id: string;
  name: string;
  color?: string;
  position: number;
  is_reuniao_marcada?: boolean;
}

/** Regra: quando lead chega nesta etapa da campanha, enviar para o funil na
 *  etapa indicada e remover da campanha. Fatia B: aceita QUALQUER funil —
 *  `pipelines.id` (canônico) ou slug/alias legado (`pipe_*`, valor histórico
 *  persistido — 1 linha em prod, lida pra sempre). */
export type CampanhaPipeAutomationTarget = string;

export interface CampanhaPipeAutomation {
  id: string;
  campanha_id: string;
  campanha_stage_id: string;
  target_pipe: CampanhaPipeAutomationTarget;
  pipe_stage: string;
  created_at: string | null;
  stage?: CampanhaStage;
}

// --- Regras de envio (lead criado ou movido para etapa) ---
export type CampanhaDispatchRuleTriggerType = "lead_created" | "lead_moved_to_stage";
export type CampanhaDispatchRuleStepActionType = "send_template" | "wait_response" | "change_stage" | "assign_sdr" | "cancel_sequence";
export type CampanhaDispatchRuleTimeoutAction = "continue" | "change_stage" | "send_template" | "cancel_sequence";
export type SdrAssignmentMode = "specific" | "round_robin";

export interface CampanhaDispatchRule {
  id: string;
  campanha_id: string;
  trigger_type: CampanhaDispatchRuleTriggerType;
  campanha_stage_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  stage?: CampanhaStage;
}

export interface CampanhaDispatchRuleStep {
  id: string;
  rule_id: string;
  action_type: CampanhaDispatchRuleStepActionType;
  template_id: string | null;
  delay_minutes: number;
  position: number;
  // wait_response fields
  wait_timeout_minutes: number | null;
  timeout_action: CampanhaDispatchRuleTimeoutAction | null;
  timeout_target_stage_id: string | null;
  timeout_template_id: string | null;
  // change_stage fields
  target_stage_id: string | null;
  // assign_sdr fields
  sdr_assignment_mode: SdrAssignmentMode | null;
  target_sdr_id: string | null;
  // joined
  template?: { id: string; name: string; content?: string; message_type?: string };
}

export function useCampanhas() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["campanhas", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("campanhas")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      // Ponte até o regen de types.ts: as colunas target_* (20270917000000)
      // são mais novas que o Row gerado — o cast desce por unknown.
      return (data ?? []) as unknown as Campanha[];
    },
    enabled: isReady && !!organizationId,
  });
}

export function useCampanha(id: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["campanha", id, organizationId],
    queryFn: async () => {
      if (!id || !organizationId) return null;

      const { data, error } = await supabase
        .from("campanhas")
        .select("*")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      return data as Campanha | null;
    },
    enabled: isReady && !!organizationId && !!id,
  });
}

// Hook to fetch campaign stages
export function useCampanhaStages(campanhaId: string | undefined) {
  return useQuery({
    queryKey: ["campanha_stages", campanhaId],
    queryFn: async () => {
      if (!campanhaId) return [];

      const { data, error } = await supabase
        .from("campanha_stages")
        .select("*")
        .eq("campanha_id", campanhaId)
        .order("position", { ascending: true });

      if (error) throw error;
      return data as CampanhaStage[];
    },
    enabled: !!campanhaId,
  });
}

/** Busca etapas de várias campanhas de uma vez (para referência de IDs em Configurações > Webhooks) */
export function useAllCampanhaStages(campaignIds: string[]) {
  return useQuery({
    queryKey: ["campanha_stages_bulk", campaignIds.sort().join(",")],
    queryFn: async () => {
      if (campaignIds.length === 0) return [];
      const { data, error } = await supabase
        .from("campanha_stages")
        .select("*")
        .in("campanha_id", campaignIds)
        .order("campanha_id")
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CampanhaStage[];
    },
    enabled: campaignIds.length > 0,
  });
}

// Hook to fetch campaign members
export function useCampanhaMembers(campanhaId: string | undefined) {
  return useQuery({
    queryKey: ["campanha_members", campanhaId],
    queryFn: async () => {
      if (!campanhaId) return [];

      const { data, error } = await supabase
        .from("campanha_members")
        .select(`
          *,
          team_member:team_members(id, name, role)
        `)
        .eq("campanha_id", campanhaId);

      if (error) throw error;
      return data as CampanhaMember[];
    },
    enabled: !!campanhaId,
  });
}

// Hook to fetch campaign leads
export function useCampanhaLeads(campanhaId: string | undefined) {
  useRealtimeSubscription("campanha_leads", ["campanha_leads"]);
  return useQuery({
    queryKey: ["campanha_leads", campanhaId],
    queryFn: async () => {
      if (!campanhaId) return [];

      const { data, error } = await supabase
        .from("campanha_leads")
        .select(`
          *,
          lead:leads(
            id, name, company, phone, email, faturamento, segment, origin, notes, responsible_id, closer_id,
            responsible:team_members!leads_responsible_id_fkey(id, name),
            closer:team_members!leads_closer_id_fkey(id, name),
            lead_tags(tag:tags(id, name, color))
          ),
          responsible:team_members!campanha_leads_responsible_id_fkey(id, name),
          sdr:team_members!campanha_leads_sdr_id_fkey(id, name),
          closer:team_members!campanha_leads_closer_id_fkey(id, name),
          stage:campanha_stages(*)
        `)
        .eq("campanha_id", campanhaId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as CampanhaLead[];
    },
    enabled: !!campanhaId,
  });
}

// Hook to create a campaign with default stages
export function useCreateCampanha() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (campanha: CampanhaInsert & {
      stages: Omit<CampanhaStageInsert, "campanha_id">[];
      memberIds: string[];
      memberRoles?: Record<string, CampanhaMemberRole>; // memberId -> 'sdr' | 'closer'
      templateIds?: string[]; // Para SEMI-AUTOMÁTICA
    }) => {
      // PERMISSION: Apenas admin pode criar campanhas
      await assertPermission("create_campaign");

      // Buscar organization_id do usuário
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: teamMember } = await supabase
        .from("team_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();

      if (!teamMember?.organization_id) throw new Error("Usuário não pertence a uma organização");

      // Create the campaign with campaign mode fields
      const { data: newCampanha, error: campanhaError } = await supabase
        .from("campanhas")
        .insert({
          name: campanha.name,
          description: campanha.description,
          deadline: campanha.deadline,
          team_goal: campanha.team_goal,
          individual_goal: campanha.individual_goal,
          bonus_value: campanha.bonus_value,
          // Objetivo estratégico
          objective: campanha.objective || 'livre',
          free_target_pipe: campanha.objective === 'livre' ? (campanha.free_target_pipe ?? null) : null,
          free_target_stage: campanha.objective === 'livre' ? (campanha.free_target_stage ?? null) : null,
          // Destino canônico (Fatia B). Cast: colunas de 20270917000000, mais
          // novas que o último types.ts gerado (regen na janela do deploy).
          ...({
            target_pipeline_id: campanha.target_pipeline_id ?? null,
            target_stage_id: campanha.target_stage_id ?? null,
          } as Record<string, unknown>),
          // Campos dos modos de campanha
          campaign_type: campanha.campaign_type || 'manual',
          agent_id: campanha.agent_id || null,
          auto_config: campanha.auto_config || null,
          // Distribuição de leads (SDR)
          lead_distribution_mode: campanha.lead_distribution_mode ?? null,
          lead_assigned_to: campanha.lead_assigned_to ?? null,
          // Distribuição de Closers
          closer_distribution_mode: campanha.closer_distribution_mode ?? null,
          closer_assigned_to: campanha.closer_assigned_to ?? null,
          // Instância WhatsApp (semi e automática)
          whatsapp_instance_id: campanha.whatsapp_instance_id ?? null,
          // Organization
          organization_id: teamMember.organization_id,
        })
        .select()
        .single();

      if (campanhaError) throw campanhaError;

      // Create stages
      if (campanha.stages.length > 0) {
        const stagesWithCampanhaId = campanha.stages.map((stage) => ({
          ...stage,
          campanha_id: newCampanha.id,
        }));

        const { error: stagesError } = await supabase
          .from("campanha_stages")
          .insert(stagesWithCampanhaId);

        if (stagesError) throw stagesError;
      }

      // Add members (with role: sdr or closer)
      if (campanha.memberIds.length > 0) {
        const members = campanha.memberIds.map((memberId) => ({
          campanha_id: newCampanha.id,
          team_member_id: memberId,
          role: campanha.memberRoles?.[memberId] || "sdr",
        }));

        const { error: membersError } = await supabase
          .from("campanha_members")
          .insert(members);

        if (membersError) throw membersError;
      }

      // Para SEMI-AUTOMÁTICA: vincular templates
      if (campanha.campaign_type === 'semi_automatica' && campanha.templateIds?.length) {
        const templateLinks = campanha.templateIds.map((templateId, index) => ({
          campanha_id: newCampanha.id,
          template_id: templateId,
          position: index,
        }));

        const { error: templatesError } = await supabase
          .from("campanha_templates")
          .insert(templateLinks);

        if (templatesError) {
          console.error("Erro ao vincular templates:", templatesError);
          throw new Error(`Erro ao vincular templates: ${templatesError.message}`);
        }
      }

      // Para AUTOMÁTICA: atualizar agente com campaign_id
      if (campanha.campaign_type === 'automatica' && campanha.agent_id) {
        await supabase
          .from("copilot_agents")
          .update({ campaign_id: newCampanha.id })
          .eq("id", campanha.agent_id);
      }

      return newCampanha;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
    },
  });
}

// Hook to update a campaign
export function useUpdateCampanha() {
  const queryClient = useQueryClient();
  const editPermission = useCanDo("edit_campaign");

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Campanha> & { id: string }) => {
      if (!editPermission.allowed) {
        throw new Error(editPermission.isLoading
          ? "Permissões ainda carregando — tente novamente"
          : "Sem permissão para editar campanhas");
      }
      const newAgentId = updates.agent_id !== undefined ? updates.agent_id : undefined;

      if (newAgentId !== undefined) {
        const { data: current } = await supabase
          .from("campanhas")
          .select("agent_id")
          .eq("id", id)
          .single();
        const oldAgentId = (current as { agent_id: string | null } | null)?.agent_id ?? null;

        if (oldAgentId) {
          await supabase
            .from("copilot_agents")
            .update({ campaign_id: null })
            .eq("id", oldAgentId);
        }
      }

      const { data, error } = await supabase
        .from("campanhas")
        // Ponte até o regen de types.ts (colunas target_* de 20270917000000).
        .update(updates as never)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      if (newAgentId !== undefined && newAgentId) {
        await supabase
          .from("copilot_agents")
          .update({ campaign_id: id })
          .eq("id", newAgentId);
      }

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
      queryClient.invalidateQueries({ queryKey: ["campanha", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["campanhas-mkt-leads"] });
    },
  });
}

// Hook to delete a campaign
export function useDeleteCampanha() {
  const queryClient = useQueryClient();
  const deletePermission = useCanDo("delete_campaign");

  return useMutation({
    mutationFn: async (id: string) => {
      if (!deletePermission.allowed) {
        throw new Error(deletePermission.isLoading
          ? "Permissões ainda carregando — tente novamente"
          : "Sem permissão para excluir campanhas");
      }
      const { error } = await supabase
        .from("campanhas")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
    },
  });
}

// Hook to update campaign investment (MKT)
export function useUpdateCampanhaInvestimento() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      investimento_cents,
      investimento_source = "manual",
    }: {
      id: string;
      investimento_cents: number | null;
      investimento_source?: "manual" | "api";
    }) => {
      const { data, error } = await supabase
        .from("campanhas")
        .update({
          investimento_cents,
          investimento_source,
          investimento_updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
      queryClient.invalidateQueries({ queryKey: ["campanha", variables.id] });
    },
  });
}

// Hook to update campaign MKT config (which leads count for Call / Cadastro by origin or tag)
export function useUpdateCampanhaMktConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      mkt_call_origins,
      mkt_call_tag_ids,
      mkt_cadastro_origins,
      mkt_cadastro_tag_ids,
      mkt_incluir_call,
      mkt_incluir_cadastro,
      mkt_investimento_call_cents,
      mkt_investimento_cadastro_cents,
    }: {
      id: string;
      mkt_call_origins?: string[] | null;
      mkt_call_tag_ids?: string[] | null;
      mkt_cadastro_origins?: string[] | null;
      mkt_cadastro_tag_ids?: string[] | null;
      mkt_incluir_call?: boolean | null;
      mkt_incluir_cadastro?: boolean | null;
      mkt_investimento_call_cents?: number | null;
      mkt_investimento_cadastro_cents?: number | null;
    }) => {
      const { data, error } = await supabase
        .from("campanhas")
        .update({
          ...(mkt_call_origins !== undefined && { mkt_call_origins }),
          ...(mkt_call_tag_ids !== undefined && { mkt_call_tag_ids }),
          ...(mkt_cadastro_origins !== undefined && { mkt_cadastro_origins }),
          ...(mkt_cadastro_tag_ids !== undefined && { mkt_cadastro_tag_ids }),
          ...(mkt_incluir_call !== undefined && { mkt_incluir_call }),
          ...(mkt_incluir_cadastro !== undefined && { mkt_incluir_cadastro }),
          ...(mkt_investimento_call_cents !== undefined && { mkt_investimento_call_cents }),
          ...(mkt_investimento_cadastro_cents !== undefined && { mkt_investimento_cadastro_cents }),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
      queryClient.invalidateQueries({ queryKey: ["campanha", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["campanhas-mkt-leads"] });
    },
  });
}

// Hook to add a lead to a campaign
export function useAddCampanhaLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { campanha_id: string; lead_id: string; stage_id: string; responsible_id?: string; sdr_id?: string; closer_id?: string }) => {
      const { data: newLead, error } = await supabase
        .from("campanha_leads")
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return newLead;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_leads", variables.campanha_id] });
    },
  });
}

// Hook to update a campaign lead (move between stages)
export function useUpdateCampanhaLead() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, campanha_id, ...updates }: { id: string; campanha_id: string; stage_id?: string; responsible_id?: string; sdr_id?: string; closer_id?: string; notes?: string }) => {
      const { data, error } = await supabase
        .from("campanha_leads")
        .update(updates)
        .eq("id", id)
        .select(`
          *,
          lead:leads(
            id, name, company, phone, email, faturamento, segment, origin, notes, responsible_id, closer_id,
            responsible:team_members!leads_responsible_id_fkey(id, name),
            closer:team_members!leads_closer_id_fkey(id, name),
            lead_tags(tag:tags(id, name, color))
          ),
          responsible:team_members!campanha_leads_responsible_id_fkey(id, name),
          sdr:team_members!campanha_leads_sdr_id_fkey(id, name),
          closer:team_members!campanha_leads_closer_id_fkey(id, name),
          stage:campanha_stages(*)
        `)
        .single();

      if (error) throw error;
      return data;
    },
    onMutate: async (variables) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["campanha_leads", variables.campanha_id] });

      // Snapshot the previous value
      const previousLeads = queryClient.getQueryData<CampanhaLead[]>(["campanha_leads", variables.campanha_id]);

      // Optimistically update to the new value
      if (previousLeads) {
        queryClient.setQueryData<CampanhaLead[]>(
          ["campanha_leads", variables.campanha_id],
          previousLeads.map((lead) =>
            lead.id === variables.id
              ? { ...lead, stage_id: variables.stage_id || lead.stage_id, responsible_id: variables.responsible_id ?? lead.responsible_id, sdr_id: variables.sdr_id ?? lead.sdr_id, notes: variables.notes ?? lead.notes }
              : lead
          )
        );
      }

      return { previousLeads };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, rollback to the previous value
      if (context?.previousLeads) {
        queryClient.setQueryData(["campanha_leads", variables.campanha_id], context.previousLeads);
      }
    },
    onSettled: (data, error, variables) => {
      // Always refetch after error or success to sync with server state
      queryClient.invalidateQueries({ queryKey: ["campanha_leads", variables.campanha_id] });
      queryClient.invalidateQueries({ queryKey: ["campanha_members", variables.campanha_id] });

      // Migrado em slice 19 (2026-05-27): publishEvent('lead.stage_changed') substitui
      // triggerStageChangedWorkflows direto. Função legacy deletada em fase 4.
      if (!error && data && variables.stage_id && data.lead_id && organizationId) {
        publishEvent({
          event_type: "lead.stage_changed",
          aggregate_type: "campanha_lead",
          aggregate_id: data.id,
          organization_id: organizationId,
          payload: {
            lead_id: data.lead_id,
            pipeline_id: null,
            campaign_id: variables.campanha_id,
            pipe_type: null,
            old_stage_key: null,
            new_stage_key: variables.stage_id,
            pipeline_slug: null,
          },
        }).catch(() => {});
      }
    },
  });
}

// Hook to delete a campaign lead
export function useDeleteCampanhaLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, campanha_id }: { id: string; campanha_id: string }) => {
      const { error } = await supabase
        .from("campanha_leads")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_leads", variables.campanha_id] });
    },
  });
}

// Hook to update member meetings count and/or role
export function useUpdateCampanhaMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ campanha_id, team_member_id, meetings_count, bonus_earned, role }: { campanha_id: string; team_member_id: string; meetings_count?: number; bonus_earned?: boolean; role?: CampanhaMemberRole }) => {
      const updates: Record<string, unknown> = {};
      if (meetings_count !== undefined) updates.meetings_count = meetings_count;
      if (bonus_earned !== undefined) updates.bonus_earned = bonus_earned;
      if (role !== undefined) updates.role = role;

      const { data, error } = await supabase
        .from("campanha_members")
        .update(updates)
        .eq("campanha_id", campanha_id)
        .eq("team_member_id", team_member_id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_members", variables.campanha_id] });
    },
  });
}

// Hook to create a new stage in a campaign
export function useCreateCampanhaStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (stage: CampanhaStageInsert) => {
      const { data, error } = await supabase
        .from("campanha_stages")
        .insert(stage)
        .select()
        .single();

      if (error) throw error;
      return data as CampanhaStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_stages", variables.campanha_id] });
    },
  });
}

// Hook to update a stage
export function useUpdateCampanhaStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, campanha_id, ...updates }: { id: string; campanha_id: string; name?: string; color?: string; position?: number; is_reuniao_marcada?: boolean }) => {
      const { data, error } = await supabase
        .from("campanha_stages")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as CampanhaStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_stages", variables.campanha_id] });
      queryClient.invalidateQueries({ queryKey: ["campanha_leads", variables.campanha_id] });
    },
  });
}

// Hook to delete a stage
export function useDeleteCampanhaStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, campanha_id }: { id: string; campanha_id: string }) => {
      // Check if there are leads in this stage
      const { data: leadsInStage, error: checkError } = await supabase
        .from("campanha_leads")
        .select("id")
        .eq("stage_id", id)
        .limit(1);

      if (checkError) throw checkError;

      if (leadsInStage && leadsInStage.length > 0) {
        throw new Error("Não é possível excluir uma etapa que contém leads. Mova os leads para outra etapa primeiro.");
      }

      const { error } = await supabase
        .from("campanha_stages")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_stages", variables.campanha_id] });
    },
  });
}

// Hook to reorder stages
export function useReorderCampanhaStages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ campanha_id, stages }: { campanha_id: string; stages: { id: string; position: number }[] }) => {
      // Update all stages positions
      const updates = stages.map((stage) =>
        supabase
          .from("campanha_stages")
          .update({ position: stage.position })
          .eq("id", stage.id)
      );

      const results = await Promise.all(updates);
      const errors = results.filter((r) => r.error);

      if (errors.length > 0) {
        throw errors[0].error;
      }

      return true;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_stages", variables.campanha_id] });
    },
  });
}

// --- Campanha allowed viewers (quem pode ver a campanha) ---

export interface CampanhaViewer {
  id: string;
  campanha_id: string;
  team_member_id: string;
  created_at: string;
  team_member?: {
    id: string;
    name: string;
    role: string;
  };
}

export function useCampanhaViewers(campanhaId: string | undefined) {
  return useQuery({
    queryKey: ["campanha_allowed_viewers", campanhaId],
    queryFn: async () => {
      if (!campanhaId) return [];
      const { data, error } = await supabase
        .from("campanha_allowed_viewers")
        .select(`
          *,
          team_member:team_members(id, name, role)
        `)
        .eq("campanha_id", campanhaId);
      if (error) throw error;
      return (data ?? []) as CampanhaViewer[];
    },
    enabled: !!campanhaId,
  });
}

export function useAddCampanhaViewer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ campanha_id, team_member_id }: { campanha_id: string; team_member_id: string }) => {
      const { data, error } = await supabase
        .from("campanha_allowed_viewers")
        .insert({ campanha_id, team_member_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_allowed_viewers", variables.campanha_id] });
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
      queryClient.invalidateQueries({ queryKey: ["campanha", variables.campanha_id] });
    },
  });
}

export function useRemoveCampanhaViewer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campanha_id }: { id: string; campanha_id: string }) => {
      const { error } = await supabase.from("campanha_allowed_viewers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_allowed_viewers", variables.campanha_id] });
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
      queryClient.invalidateQueries({ queryKey: ["campanha", variables.campanha_id] });
    },
  });
}

// --- Automações: ao mover lead para etapa X da campanha, enviar para pipe e remover da campanha ---

export function useCampanhaPipeAutomations(campanhaId: string | undefined) {
  return useQuery({
    queryKey: ["campanha_pipe_automations", campanhaId],
    queryFn: async () => {
      if (!campanhaId) return [];
      const { data, error } = await supabase
        .from("campanha_pipe_automations")
        .select(`
          *,
          stage:campanha_stages(id, name, color, position)
        `)
        .eq("campanha_id", campanhaId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CampanhaPipeAutomation[];
    },
    enabled: !!campanhaId,
  });
}

export function useCreateCampanhaPipeAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      campanha_id: string;
      campanha_stage_id: string;
      target_pipe: CampanhaPipeAutomationTarget;
      pipe_stage: string;
    }) => {
      const { data, error } = await supabase
        .from("campanha_pipe_automations")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as CampanhaPipeAutomation;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_pipe_automations", variables.campanha_id] });
    },
  });
}

export function useDeleteCampanhaPipeAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campanha_id }: { id: string; campanha_id: string }) => {
      const { error } = await supabase.from("campanha_pipe_automations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_pipe_automations", variables.campanha_id] });
    },
  });
}

// --- Regras de envio por etapa (disparo de sequência de mensagens) ---

export function useCampanhaDispatchRules(campanhaId: string | undefined) {
  return useQuery({
    queryKey: ["campanha_dispatch_rules", campanhaId],
    queryFn: async () => {
      if (!campanhaId) return [];
      const { data, error } = await supabase
        .from("campanha_dispatch_rules")
        .select("*")
        .eq("campanha_id", campanhaId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CampanhaDispatchRule[];
    },
    enabled: !!campanhaId,
  });
}

export function useCampanhaDispatchRuleSteps(ruleId: string | undefined) {
  return useQuery({
    queryKey: ["campanha_dispatch_rule_steps", ruleId],
    queryFn: async () => {
      if (!ruleId) return [];
      const { data, error } = await supabase
        .from("campanha_dispatch_rule_steps")
        .select(`
          *,
          template:campaign_templates!template_id(id, name, content, message_type, audio_url)
        `)
        .eq("rule_id", ruleId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CampanhaDispatchRuleStep[];
    },
    enabled: !!ruleId,
  });
}

export function useCreateCampanhaDispatchRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      campanha_id: string;
      trigger_type: CampanhaDispatchRuleTriggerType;
      campanha_stage_id?: string | null;
      is_active?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("campanha_dispatch_rules")
        .insert({
          campanha_id: payload.campanha_id,
          trigger_type: payload.trigger_type,
          campanha_stage_id: payload.trigger_type === "lead_moved_to_stage" ? payload.campanha_stage_id ?? null : null,
          is_active: payload.is_active ?? true,
        })
        .select()
        .single();
      if (error) throw error;
      return data as CampanhaDispatchRule;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rules", variables.campanha_id] });
    },
  });
}

export function useUpdateCampanhaDispatchRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      campanha_id,
      trigger_type,
      campanha_stage_id,
      is_active,
    }: {
      id: string;
      campanha_id: string;
      trigger_type?: CampanhaDispatchRuleTriggerType;
      campanha_stage_id?: string | null;
      is_active?: boolean;
    }) => {
      const updates: Record<string, unknown> = {};
      if (trigger_type !== undefined) updates.trigger_type = trigger_type;
      if (campanha_stage_id !== undefined) updates.campanha_stage_id = (trigger_type === "lead_moved_to_stage" ? campanha_stage_id : null) ?? null;
      if (is_active !== undefined) updates.is_active = is_active;
      const { data, error } = await supabase
        .from("campanha_dispatch_rules")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as CampanhaDispatchRule;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rules", variables.campanha_id] });
    },
  });
}

export function useDeleteCampanhaDispatchRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campanha_id }: { id: string; campanha_id: string }) => {
      const { error } = await supabase.from("campanha_dispatch_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rules", variables.campanha_id] });
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rule_steps"] });
    },
  });
}

export function useCreateCampanhaDispatchRuleStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      rule_id: string;
      action_type?: CampanhaDispatchRuleStepActionType;
      template_id?: string | null;
      delay_minutes?: number;
      position: number;
      wait_timeout_minutes?: number | null;
      timeout_action?: CampanhaDispatchRuleTimeoutAction | null;
      timeout_target_stage_id?: string | null;
      timeout_template_id?: string | null;
      target_stage_id?: string | null;
      sdr_assignment_mode?: SdrAssignmentMode | null;
      target_sdr_id?: string | null;
    }) => {
      const insertData: Record<string, unknown> = {
        rule_id: payload.rule_id,
        action_type: payload.action_type || "send_template",
        delay_minutes: Math.max(0, Math.floor(Number(payload.delay_minutes) || 0)),
        position: payload.position,
      };
      if (payload.template_id) insertData.template_id = payload.template_id;
      if (payload.wait_timeout_minutes != null) insertData.wait_timeout_minutes = payload.wait_timeout_minutes;
      if (payload.timeout_action) insertData.timeout_action = payload.timeout_action;
      if (payload.timeout_target_stage_id) insertData.timeout_target_stage_id = payload.timeout_target_stage_id;
      if (payload.timeout_template_id) insertData.timeout_template_id = payload.timeout_template_id;
      if (payload.target_stage_id) insertData.target_stage_id = payload.target_stage_id;
      if (payload.sdr_assignment_mode) insertData.sdr_assignment_mode = payload.sdr_assignment_mode;
      if (payload.target_sdr_id) insertData.target_sdr_id = payload.target_sdr_id;

      const { data, error } = await supabase
        .from("campanha_dispatch_rule_steps")
        .insert(insertData)
        .select()
        .single();
      if (error) throw error;
      return data as CampanhaDispatchRuleStep;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rule_steps", variables.rule_id] });
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rules"] });
    },
  });
}

export function useUpdateCampanhaDispatchRuleStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      rule_id,
      template_id,
      delay_minutes,
      position,
    }: {
      id: string;
      rule_id: string;
      template_id?: string;
      delay_minutes?: number;
      position?: number;
    }) => {
      const updates: Record<string, unknown> = {};
      if (template_id !== undefined) updates.template_id = template_id;
      if (delay_minutes !== undefined) updates.delay_minutes = delay_minutes;
      if (position !== undefined) updates.position = position;
      const { data, error } = await supabase
        .from("campanha_dispatch_rule_steps")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as CampanhaDispatchRuleStep;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rule_steps", variables.rule_id] });
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rules"] });
    },
  });
}

export function useDeleteCampanhaDispatchRuleStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, rule_id }: { id: string; rule_id: string }) => {
      const { error } = await supabase.from("campanha_dispatch_rule_steps").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rule_steps", variables.rule_id] });
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rules"] });
    },
  });
}

// --- Resolver destino de extração a partir do objetivo da campanha ---

/**
 * Destino da extração, id-first (Fatia B):
 *   1. `target_pipeline_id`/`target_stage_id` — o par canônico (qualquer funil);
 *   2. objetivo fixo legado → OBJECTIVE_TARGET_MAP (slug + stage_key);
 *   3. 'livre' legado → free_target_pipe/free_target_stage (alias `pipe_*`,
 *      que o resolvedor de funil entende) — aceito na leitura pra sempre;
 *   4. nada resolve → null (campanha livre sem destino, comportamento de sempre).
 *
 * `pipeline` é referência (uuid, slug ou alias) e `stage` é referência
 * (`pipeline_stages.id` uuid ou stage_key) — exatamente o que
 * `useExtractLeadToPipe` resolve contra o modelo canônico.
 */
export function resolveExtractionTarget(
  campanha: Pick<
    Campanha,
    'objective' | 'free_target_pipe' | 'free_target_stage' | 'target_pipeline_id' | 'target_stage_id'
  >,
): { pipeline: string; stage: string } | null {
  if (campanha.target_pipeline_id && campanha.target_stage_id) {
    return { pipeline: campanha.target_pipeline_id, stage: campanha.target_stage_id };
  }
  if (campanha.objective !== 'livre') {
    return OBJECTIVE_TARGET_MAP[campanha.objective];
  }
  if (campanha.free_target_pipe && campanha.free_target_stage) {
    return { pipeline: campanha.free_target_pipe, stage: campanha.free_target_stage };
  }
  return null; // Campanha livre sem destino configurado
}

// --- Extrair lead da campanha e enviar para um funil (sai da campanha, entra no funil) ---

/** @deprecated Fatia B: o alvo virou referência livre de funil (uuid/slug/alias).
 *  Mantido só pela API pública do módulo até a F6 demolir o vocabulário. */
export type ExtractLeadToPipeTarget = string;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aliases legados persistidos (free_target_pipe / automações antigas). */
const LEGACY_PIPE_ALIASES: Record<string, string> = {
  pipe_whatsapp: "whatsapp",
  pipe_confirmacao: "confirmacao",
  pipe_propostas: "propostas",
  qualificacao: "whatsapp",
};

/**
 * Extrai o lead da campanha para (funil, etapa) — QUALQUER funil da org, por
 * referência (Fatia B). Escrita canônica em `pipeline_entries` (a mesma tabela
 * que os INSTEAD OF das views legadas alimentavam — sem passar pelas views,
 * que têm data pra morrer na F6). Comportamento preservado do fluxo legado:
 *   · lead já no funil → só muda de etapa (update);
 *   · lead fora → entra na etapa (insert), com responsável efetivo
 *     `responsible_id ?? sdr_id ?? closer_id` e metadata espelhando o que as
 *     views gravavam (responsible_id/sdr_id/closer_id);
 *   · follow-up automation: `follow_up_automations` ainda é indexada por
 *     `pipe_type` do trio — dispara só quando o destino é um funil de slug
 *     whatsapp/confirmacao/propostas (ponte legada; funil custom nunca teve
 *     automação dessas, então nada muda pra ele);
 *   · por fim remove o lead da campanha (campanha_leads).
 */
export function useExtractLeadToPipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      campanha_lead_id,
      campanha_id,
      lead_id,
      pipeline,
      stage,
      organization_id,
      responsible_id,
      sdr_id,
      closer_id,
      campaign_name,
    }: {
      campanha_lead_id: string;
      campanha_id: string;
      lead_id: string;
      /** Funil de destino: `pipelines.id` (canônico) ou slug/alias legado. */
      pipeline: string;
      /** Etapa de destino: `pipeline_stages.id` (canônico) ou stage_key legada. */
      stage: string;
      organization_id: string;
      responsible_id?: string | null;
      sdr_id?: string | null;
      closer_id?: string | null;
      campaign_name?: string;
    }) => {
      const notes = campaign_name ? `Campanha: ${campaign_name}` : undefined;

      // 1. Resolve o funil na org (id-first; slug/alias legado pra sempre).
      const ref = pipeline.trim();
      const slugRef = LEGACY_PIPE_ALIASES[ref.toLowerCase()] ?? ref;
      let pipeQuery = supabase
        .from("pipelines")
        .select("id, slug")
        .eq("organization_id", organization_id);
      pipeQuery = UUID_RE.test(ref) ? pipeQuery.eq("id", ref) : pipeQuery.eq("slug", slugRef);
      const { data: pipelineRow, error: pipeErr } = await pipeQuery.maybeSingle();
      if (pipeErr) throw pipeErr;
      if (!pipelineRow) throw new Error(`Funil "${pipeline}" não encontrado nesta organização.`);

      // 2. Resolve a etapa DENTRO do funil (uuid casa qualquer linha; key só
      //    etapa ativa — mesma semântica do motor moveStage do servidor).
      let stageQuery = supabase
        .from("pipeline_stages")
        .select("id, stage_key")
        .eq("organization_id", organization_id)
        .eq("pipeline_id", pipelineRow.id);
      stageQuery = UUID_RE.test(stage.trim())
        ? stageQuery.eq("id", stage.trim())
        : stageQuery.eq("stage_key", stage.trim()).eq("is_active", true);
      const { data: stageRow, error: stageErr } = await stageQuery.maybeSingle();
      if (stageErr) throw stageErr;
      if (!stageRow) throw new Error(`Etapa "${stage}" não existe neste funil.`);

      // 3. Entry corrente do par (funil, lead): primeira ABERTA; senão a mais
      //    recente (mesma regra do pickActiveEntry do servidor).
      const { data: entries, error: readErr } = await supabase
        .from("pipeline_entries")
        .select("id, closed_at, entered_at")
        .eq("organization_id", organization_id)
        .eq("pipeline_id", pipelineRow.id)
        .eq("lead_id", lead_id)
        .order("entered_at", { ascending: false })
        .limit(50);
      if (readErr) throw readErr;
      const existing =
        (entries ?? []).find((e) => !e.closed_at) ?? (entries ?? [])[0] ?? null;

      const effectiveResponsible = responsible_id ?? sdr_id ?? closer_id ?? null;

      if (!existing) {
        const { error: insErr } = await supabase.from("pipeline_entries").insert({
          lead_id,
          organization_id,
          pipeline_id: pipelineRow.id,
          // stage_id é o canônico; o trigger espelho preenche a stage_key.
          stage_id: stageRow.id,
          stage_key: stageRow.stage_key,
          assigned_to: effectiveResponsible,
          notes: notes ?? null,
          metadata: {
            responsible_id: responsible_id ?? null,
            sdr_id: sdr_id ?? null,
            closer_id: closer_id ?? null,
          },
        });
        if (insErr) throw insErr;

        // Ponte legada: follow_up_automations ainda é por pipe_type do trio.
        const trioSlug = ["whatsapp", "confirmacao", "propostas"].includes(pipelineRow.slug)
          ? (pipelineRow.slug as "whatsapp" | "confirmacao" | "propostas")
          : null;
        if (trioSlug) {
          await triggerFollowUpAutomation({
            leadId: lead_id,
            assignedTo: effectiveResponsible,
            pipeType: trioSlug,
            stage: stageRow.stage_key,
            sourcePipeId: pipelineRow.id,
            organizationId: organization_id,
          });
        }
      } else {
        const { error: updateErr } = await supabase
          .from("pipeline_entries")
          .update({ stage_id: stageRow.id, stage_key: stageRow.stage_key, ...(notes && { notes }) })
          .eq("id", existing.id);
        if (updateErr) throw updateErr;
      }

      const { error: delError } = await supabase
        .from("campanha_leads")
        .delete()
        .eq("id", campanha_lead_id);
      if (delError) throw delError;

      return { pipeline_id: pipelineRow.id };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_leads", variables.campanha_id] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}
