/**
 * Hook para métricas do Agente Copilot
 *
 * Busca e calcula métricas de performance do agente:
 * - Total de conversas
 * - Mensagens enviadas/recebidas
 * - Taxa de resposta
 * - Reuniões agendadas
 * - Leads qualificados
 * - Follow-ups enviados
 * - Tempo médio de resposta
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AgentMetrics {
  totalConversations: number;
  messagesSent: number;
  messagesReceived: number;
  responseRate: number;
  meetingsScheduled: number;
  leadsQualified: number;
  followupsSent: number;
  avgResponseTime: number; // em segundos
  leadsAttended: number;
  conversionRate: number;
}

export interface AgentMetricsTrend {
  current: number;
  previous: number;
  percentChange: number;
  isPositive: boolean;
}

export interface AgentMetricsWithTrends extends AgentMetrics {
  trends: {
    conversations: AgentMetricsTrend;
    meetings: AgentMetricsTrend;
    qualified: AgentMetricsTrend;
    responseRate: AgentMetricsTrend;
  };
}

/**
 * Hook para buscar métricas do agente
 * 
 * @param agentId - ID do agente
 * @param period - Período de análise ('7d', '30d', '90d')
 */
export function useAgentMetrics(agentId: string | undefined, period: '7d' | '30d' | '90d' = '30d') {
  return useQuery({
    queryKey: ['agent-metrics', agentId, period],
    queryFn: async (): Promise<AgentMetricsWithTrends> => {
      if (!agentId) throw new Error('Agent ID is required');

      // Calcular datas baseado no período
      const now = new Date();
      const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const startDate = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
      const previousStartDate = new Date(startDate.getTime() - periodDays * 24 * 60 * 60 * 1000);

      // Buscar dados do agente para obter organization_id
      const { data: agent } = await supabase
        .from('copilot_agents')
        .select('organization_id')
        .eq('id', agentId)
        .single();

      if (!agent) throw new Error('Agent not found');

      // 1. Total de conversas (período atual)
      const { count: totalConversations } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .gte('created_at', startDate.toISOString());

      // Conversas período anterior
      const { count: prevConversations } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .gte('created_at', previousStartDate.toISOString())
        .lt('created_at', startDate.toISOString());

      // 2. Mensagens enviadas (outgoing)
      const { count: messagesSent } = await supabase
        .from('whatsapp_messages')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', agent.organization_id)
        .eq('direction', 'outgoing')
        .eq('is_from_agent', true)
        .gte('created_at', startDate.toISOString());

      // 3. Mensagens recebidas (incoming)
      const { count: messagesReceived } = await supabase
        .from('whatsapp_messages')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', agent.organization_id)
        .eq('direction', 'incoming')
        .gte('created_at', startDate.toISOString());

      // 4. Decisões do agente (reuniões agendadas, qualificações)
      const { data: decisions } = await supabase
        .from('agent_decision_logs')
        .select('action_decided, state_after')
        .eq('organization_id', agent.organization_id)
        .gte('created_at', startDate.toISOString());

      const meetingsScheduled = decisions?.filter(d => d.action_decided === 'SCHEDULE_MEETING').length || 0;
      const leadsQualified = decisions?.filter(d => d.state_after === 'QUALIFIED').length || 0;

      // Decisões período anterior
      const { data: prevDecisions } = await supabase
        .from('agent_decision_logs')
        .select('action_decided, state_after')
        .eq('organization_id', agent.organization_id)
        .gte('created_at', previousStartDate.toISOString())
        .lt('created_at', startDate.toISOString());

      const prevMeetings = prevDecisions?.filter(d => d.action_decided === 'SCHEDULE_MEETING').length || 0;
      const prevQualified = prevDecisions?.filter(d => d.state_after === 'QUALIFIED').length || 0;

      // 5. Leads atendidos (conversas únicas)
      const { data: uniqueLeads } = await supabase
        .from('conversations')
        .select('lead_id')
        .eq('agent_id', agentId)
        .gte('created_at', startDate.toISOString());

      const leadsAttended = new Set(uniqueLeads?.map(l => l.lead_id)).size;

      // 6. Follow-ups enviados (baseado em contexto de follow-up)
      const { count: followupsSent } = await supabase
        .from('conversation_context_summary')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', agent.organization_id)
        .gt('followup_count', 0)
        .gte('updated_at', startDate.toISOString());

      // 7. Calcular taxa de resposta e tempo médio
      const responseRate = messagesReceived && messagesSent 
        ? Math.min(100, Math.round((messagesSent / messagesReceived) * 100))
        : 0;

      const prevResponseRate = 85; // Placeholder - calcular do período anterior

      // 8. Calcular taxa de conversão
      const conversionRate = leadsAttended > 0 
        ? Math.round((meetingsScheduled / leadsAttended) * 100) 
        : 0;

      // Calcular tendências
      const calculateTrend = (current: number, previous: number): AgentMetricsTrend => {
        const percentChange = previous > 0 
          ? Math.round(((current - previous) / previous) * 100) 
          : current > 0 ? 100 : 0;
        return {
          current,
          previous,
          percentChange,
          isPositive: percentChange >= 0,
        };
      };

      return {
        totalConversations: totalConversations || 0,
        messagesSent: messagesSent || 0,
        messagesReceived: messagesReceived || 0,
        responseRate,
        meetingsScheduled,
        leadsQualified,
        followupsSent: followupsSent || 0,
        avgResponseTime: 45, // Placeholder - calcular tempo real
        leadsAttended,
        conversionRate,
        trends: {
          conversations: calculateTrend(totalConversations || 0, prevConversations || 0),
          meetings: calculateTrend(meetingsScheduled, prevMeetings),
          qualified: calculateTrend(leadsQualified, prevQualified),
          responseRate: calculateTrend(responseRate, prevResponseRate),
        },
      };
    },
    enabled: !!agentId,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
}

/**
 * Hook para buscar tarefas pendentes do agente
 * 
 * Retorna leads que precisam de ação:
 * - Leads sem resposta há X dias
 * - Reuniões para confirmar
 * - Leads para reengajar
 */
export function useAgentPendingTasks(agentId: string | undefined) {
  return useQuery({
    queryKey: ['agent-pending-tasks', agentId],
    queryFn: async () => {
      if (!agentId) throw new Error('Agent ID is required');

      // Buscar dados do agente
      const { data: agent } = await supabase
        .from('copilot_agents')
        .select('organization_id, template_type')
        .eq('id', agentId)
        .single();

      if (!agent) throw new Error('Agent not found');

      // 1. Leads sem resposta há mais de 24h (para follow-up)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      const { data: leadsNoResponse } = await supabase
        .from('conversation_context_summary')
        .select(`
          lead_id,
          last_topic,
          last_intent,
          lead_temperature,
          engagement_score,
          last_message_at,
          followup_count,
          lead:leads(id, name, phone, company, pipe_whatsapp)
        `)
        .eq('organization_id', agent.organization_id)
        .lt('last_message_at', oneDayAgo)
        .order('last_message_at', { ascending: true })
        .limit(20);

      // 2. Reuniões agendadas para confirmar (próximos 5 dias)
      const fiveDaysFromNow = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      
      const { data: meetingsToConfirm } = await supabase
        .from('confirmacoes')
        .select(`
          id,
          data_reuniao,
          hora_reuniao,
          status,
          lead:leads(id, name, phone, company)
        `)
        .eq('organization_id', agent.organization_id)
        .gte('data_reuniao', new Date().toISOString().split('T')[0])
        .lte('data_reuniao', fiveDaysFromNow.split('T')[0])
        .in('status', ['reuniao_marcada', 'confirmar_d5', 'confirmar_d3', 'confirmar_d2', 'confirmar_d1'])
        .limit(10);

      // 3. Leads quentes que esfriaram (eram HOT, agora sem resposta há 3+ dias)
      const { data: coldLeads } = await supabase
        .from('conversation_context_summary')
        .select(`
          lead_id,
          last_topic,
          lead_temperature,
          engagement_score,
          last_message_at,
          lead:leads(id, name, phone, company, pipe_whatsapp)
        `)
        .eq('organization_id', agent.organization_id)
        .eq('lead_temperature', 'hot')
        .lt('last_message_at', threeDaysAgo)
        .limit(10);

      // 4. Leads com objeções não resolvidas
      const { data: leadsWithObjections } = await supabase
        .from('conversation_context_summary')
        .select(`
          lead_id,
          last_topic,
          objections_raised,
          lead_temperature,
          last_message_at,
          lead:leads(id, name, phone, company)
        `)
        .eq('organization_id', agent.organization_id)
        .not('objections_raised', 'eq', '{}')
        .limit(10);

      // Formatar tarefas
      const tasks = [];

      // Tarefas de follow-up
      if (leadsNoResponse) {
        for (const item of leadsNoResponse) {
          if (item.lead) {
            const daysSinceLastMessage = item.last_message_at 
              ? Math.floor((Date.now() - new Date(item.last_message_at).getTime()) / (24 * 60 * 60 * 1000))
              : 0;
            
            tasks.push({
              id: `followup-${item.lead_id}`,
              type: 'followup' as const,
              priority: item.lead_temperature === 'hot' ? 'high' : item.lead_temperature === 'warm' ? 'medium' : 'low',
              title: `Follow-up com ${(item.lead as any).name || 'Lead'}`,
              description: item.last_topic 
                ? `Último assunto: "${item.last_topic.substring(0, 50)}..."`
                : `Sem resposta há ${daysSinceLastMessage} dia(s)`,
              lead: item.lead,
              metadata: {
                daysSinceLastMessage,
                temperature: item.lead_temperature,
                engagementScore: item.engagement_score,
                followupCount: item.followup_count,
              },
            });
          }
        }
      }

      // Tarefas de confirmação
      if (meetingsToConfirm) {
        for (const meeting of meetingsToConfirm) {
          if (meeting.lead) {
            tasks.push({
              id: `confirm-${meeting.id}`,
              type: 'confirmation' as const,
              priority: 'high' as const,
              title: `Confirmar reunião com ${(meeting.lead as any).name || 'Lead'}`,
              description: `${meeting.data_reuniao} às ${meeting.hora_reuniao}`,
              lead: meeting.lead,
              metadata: {
                meetingDate: meeting.data_reuniao,
                meetingTime: meeting.hora_reuniao,
                status: meeting.status,
              },
            });
          }
        }
      }

      // Tarefas de reengajamento
      if (coldLeads) {
        for (const item of coldLeads) {
          if (item.lead) {
            tasks.push({
              id: `reengage-${item.lead_id}`,
              type: 'reengage' as const,
              priority: 'high' as const,
              title: `Reengajar ${(item.lead as any).name || 'Lead'} (era HOT)`,
              description: `Score: ${item.engagement_score}/100 - Esfriou`,
              lead: item.lead,
              metadata: {
                temperature: item.lead_temperature,
                engagementScore: item.engagement_score,
              },
            });
          }
        }
      }

      // Ordenar por prioridade
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      return {
        tasks,
        summary: {
          totalTasks: tasks.length,
          followups: tasks.filter(t => t.type === 'followup').length,
          confirmations: tasks.filter(t => t.type === 'confirmation').length,
          reengagements: tasks.filter(t => t.type === 'reengage').length,
        },
      };
    },
    enabled: !!agentId,
    staleTime: 2 * 60 * 1000, // 2 minutos
  });
}
