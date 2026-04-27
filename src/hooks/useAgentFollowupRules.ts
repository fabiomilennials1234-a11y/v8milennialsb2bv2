/**
 * Hook para gerenciar regras de Follow-up do Agente
 *
 * CRUD completo de regras de follow-up:
 * - Listar regras do agente
 * - Criar nova regra
 * - Atualizar regra existente
 * - Deletar regra
 * - Ativar/desativar regra
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { FollowupRule, CustomFieldFilter } from "@/types/copilot";

// Interface para regra do banco de dados
interface FollowupRuleDB {
  id: string;
  agent_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  priority: number;
  trigger_type: string;
  trigger_delay_hours: number;
  trigger_delay_minutes: number;
  max_followups: number;
  filter_tags: string[];
  filter_tags_exclude: string[];
  filter_origins: string[];
  filter_pipes: string[];
  filter_stages: string[];
  filter_custom_fields: Record<string, any>;
  use_last_context: boolean;
  context_lookback_days: number;
  followup_style: string;
  message_template: string | null;
  send_only_business_hours: boolean;
  business_hours_start: string;
  business_hours_end: string;
  send_days: string[];
  timezone: string;
  created_at: string;
  updated_at: string;
}

// Converter de DB para frontend
function dbToFollowupRule(db: FollowupRuleDB): FollowupRule {
  return {
    id: db.id,
    name: db.name,
    description: db.description || undefined,
    isActive: db.is_active,
    priority: db.priority,
    triggerType: db.trigger_type as any,
    triggerDelayHours: db.trigger_delay_hours,
    triggerDelayMinutes: db.trigger_delay_minutes,
    maxFollowups: db.max_followups,
    filterTags: db.filter_tags || [],
    filterTagsExclude: db.filter_tags_exclude || [],
    filterOrigins: db.filter_origins || [],
    filterPipes: db.filter_pipes || [],
    filterStages: db.filter_stages || [],
    filterCustomFields: Object.entries(db.filter_custom_fields || {}).map(([field, config]: [string, any]) => ({
      field,
      operator: config.operator,
      value: config.value,
    })),
    useLastContext: db.use_last_context,
    contextLookbackDays: db.context_lookback_days,
    followupStyle: db.followup_style as any,
    messageTemplate: db.message_template || undefined,
    sendOnlyBusinessHours: db.send_only_business_hours,
    businessHoursStart: db.business_hours_start,
    businessHoursEnd: db.business_hours_end,
    sendDays: db.send_days || [],
    timezone: db.timezone,
  };
}

// Converter de frontend para DB (exportado para uso na criação do agente)
export function followupRuleToDB(rule: Partial<FollowupRule>, agentId: string): Partial<FollowupRuleDB> {
  const customFieldsObj: Record<string, any> = {};
  if (rule.filterCustomFields) {
    rule.filterCustomFields.forEach((cf: CustomFieldFilter) => {
      customFieldsObj[cf.field] = { operator: cf.operator, value: cf.value };
    });
  }

  return {
    agent_id: agentId,
    name: rule.name,
    description: rule.description || null,
    is_active: rule.isActive ?? true,
    priority: rule.priority ?? 0,
    trigger_type: rule.triggerType || 'no_response',
    trigger_delay_hours: rule.triggerDelayHours ?? 24,
    trigger_delay_minutes: rule.triggerDelayMinutes ?? 0,
    max_followups: rule.maxFollowups ?? 3,
    filter_tags: rule.filterTags || [],
    filter_tags_exclude: rule.filterTagsExclude || [],
    filter_origins: rule.filterOrigins || [],
    filter_pipes: rule.filterPipes || [],
    filter_stages: rule.filterStages || [],
    filter_custom_fields: customFieldsObj,
    use_last_context: rule.useLastContext ?? true,
    context_lookback_days: rule.contextLookbackDays ?? 30,
    followup_style: rule.followupStyle || 'direct',
    message_template: rule.messageTemplate || null,
    send_only_business_hours: rule.sendOnlyBusinessHours ?? true,
    business_hours_start: rule.businessHoursStart || '09:00',
    business_hours_end: rule.businessHoursEnd || '18:00',
    send_days: rule.sendDays || ['seg', 'ter', 'qua', 'qui', 'sex'],
    timezone: rule.timezone || 'America/Sao_Paulo',
  };
}

/**
 * Hook para buscar regras de follow-up do agente
 */
export function useAgentFollowupRules(agentId: string | undefined) {
  return useQuery({
    queryKey: ['agent-followup-rules', agentId],
    queryFn: async (): Promise<FollowupRule[]> => {
      if (!agentId) throw new Error('Agent ID is required');

      const { data, error } = await supabase
        .from('copilot_agent_followup_rules')
        .select('*')
        .eq('agent_id', agentId)
        .order('priority', { ascending: true });

      if (error) {
        console.error('Error fetching followup rules:', error);
        throw error;
      }

      return (data || []).map(dbToFollowupRule);
    },
    enabled: !!agentId,
  });
}

/**
 * Hook para criar uma nova regra de follow-up
 */
export function useCreateFollowupRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ agentId, rule }: { agentId: string; rule: Partial<FollowupRule> }) => {
      const dbRule = followupRuleToDB(rule, agentId);

      const { data, error } = await supabase
        .from('copilot_agent_followup_rules')
        .insert(dbRule as any)
        .select()
        .single();

      if (error) {
        console.error('Error creating followup rule:', error);
        throw error;
      }

      return dbToFollowupRule(data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-followup-rules', variables.agentId] });
      toast.success('Regra de follow-up criada com sucesso!');
    },
    onError: (error: any) => {
      console.error('Error creating followup rule:', error);
      const msg = error?.message || error?.error_description || error?.details || 'Erro ao criar regra de follow-up';
      toast.error('Erro ao criar regra de follow-up', { description: msg });
    },
  });
}

/**
 * Hook para atualizar uma regra de follow-up
 */
export function useUpdateFollowupRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      ruleId, 
      agentId, 
      updates 
    }: { 
      ruleId: string; 
      agentId: string; 
      updates: Partial<FollowupRule> 
    }) => {
      const dbUpdates = followupRuleToDB(updates, agentId);
      delete (dbUpdates as any).agent_id; // Não atualizar agent_id

      const { data, error } = await supabase
        .from('copilot_agent_followup_rules')
        .update(dbUpdates as any)
        .eq('id', ruleId)
        .select()
        .single();

      if (error) {
        console.error('Error updating followup rule:', error);
        throw error;
      }

      return dbToFollowupRule(data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-followup-rules', variables.agentId] });
      toast.success('Regra atualizada com sucesso!');
    },
    onError: (error) => {
      console.error('Error updating followup rule:', error);
      toast.error('Erro ao atualizar regra');
    },
  });
}

/**
 * Hook para deletar uma regra de follow-up
 */
export function useDeleteFollowupRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ruleId, agentId }: { ruleId: string; agentId: string }) => {
      const { error } = await supabase
        .from('copilot_agent_followup_rules')
        .delete()
        .eq('id', ruleId);

      if (error) {
        console.error('Error deleting followup rule:', error);
        throw error;
      }

      return ruleId;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-followup-rules', variables.agentId] });
      toast.success('Regra removida com sucesso!');
    },
    onError: (error) => {
      console.error('Error deleting followup rule:', error);
      toast.error('Erro ao remover regra');
    },
  });
}

/**
 * Hook para ativar/desativar uma regra de follow-up
 */
export function useToggleFollowupRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      ruleId, 
      agentId, 
      isActive 
    }: { 
      ruleId: string; 
      agentId: string; 
      isActive: boolean 
    }) => {
      const { data, error } = await supabase
        .from('copilot_agent_followup_rules')
        .update({ is_active: isActive })
        .eq('id', ruleId)
        .select()
        .single();

      if (error) {
        console.error('Error toggling followup rule:', error);
        throw error;
      }

      return dbToFollowupRule(data);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-followup-rules', variables.agentId] });
      toast.success(variables.isActive ? 'Regra ativada!' : 'Regra desativada!');
    },
    onError: (error) => {
      console.error('Error toggling followup rule:', error);
      toast.error('Erro ao alterar status da regra');
    },
  });
}

/**
 * Hook para reordenar regras de follow-up
 */
export function useReorderFollowupRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      agentId, 
      ruleIds 
    }: { 
      agentId: string; 
      ruleIds: string[] 
    }) => {
      // Atualizar prioridade de cada regra
      const updates = ruleIds.map((id, index) => 
        supabase
          .from('copilot_agent_followup_rules')
          .update({ priority: index })
          .eq('id', id)
      );

      await Promise.all(updates);
      return ruleIds;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-followup-rules', variables.agentId] });
    },
    onError: (error) => {
      console.error('Error reordering followup rules:', error);
      toast.error('Erro ao reordenar regras');
    },
  });
}
