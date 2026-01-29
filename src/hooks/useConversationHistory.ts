import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Interface para mensagens de conversa
 */
interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

/**
 * Interface para conversa
 */
interface Conversation {
  id: string;
  lead_id: string;
  agent_id: string;
  state: string;
  turn_count: number;
  context: Record<string, any>;
  last_message_at: string;
  created_at: string;
  messages?: ConversationMessage[];
}

/**
 * Interface para resumo de conversa
 */
interface ConversationSummary {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  summary: string;
  key_points: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  lead_temperature: 'cold' | 'warm' | 'hot';
  objections: string[];
  questions_asked: string[];
  next_action: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Interface para mensagens do WhatsApp
 */
interface WhatsAppMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  content: string | null;
  message_type: string;
  push_name: string | null;
  timestamp: string;
  created_at: string;
}

/**
 * Hook para buscar histórico de conversa de um lead
 * Combina dados de conversation_messages e whatsapp_messages
 */
export function useConversationHistory(leadId: string | null) {
  return useQuery({
    queryKey: ["conversation-history", leadId],
    queryFn: async () => {
      if (!leadId) return null;

      // Buscar conversa do lead
      const { data: conversation, error: convError } = await supabase
        .from("conversations")
        .select(`
          *,
          copilot_agents(id, name)
        `)
        .eq("lead_id", leadId)
        .maybeSingle();

      if (convError) {
        console.error("[useConversationHistory] Error fetching conversation:", convError);
      }

      // Buscar mensagens da conversa (se existir)
      let conversationMessages: ConversationMessage[] = [];
      if (conversation) {
        const { data: messages } = await supabase
          .from("conversation_messages")
          .select("*")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: true });

        if (messages) {
          conversationMessages = messages;
        }
      }

      // Buscar mensagens do WhatsApp
      const { data: whatsappMessages } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("lead_id", leadId)
        .order("timestamp", { ascending: true });

      // Combinar mensagens, usando WhatsApp como fonte principal se não houver conversation_messages
      const allMessages = conversationMessages.length > 0 
        ? conversationMessages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.created_at,
            source: 'conversation' as const,
          }))
        : (whatsappMessages || []).map(m => ({
            id: m.id,
            role: m.direction === 'incoming' ? 'user' as const : 'assistant' as const,
            content: m.content || '',
            timestamp: m.timestamp,
            source: 'whatsapp' as const,
            pushName: m.push_name,
          }));

      return {
        conversation,
        messages: allMessages,
        messageCount: allMessages.length,
        whatsappMessages: whatsappMessages || [],
      };
    },
    enabled: !!leadId,
  });
}

/**
 * Hook para buscar resumo da conversa
 */
export function useConversationSummary(leadId: string | null) {
  return useQuery({
    queryKey: ["conversation-summary", leadId],
    queryFn: async () => {
      if (!leadId) return null;

      const { data, error } = await supabase
        .from("conversation_summaries")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[useConversationSummary] Error:", error);
        return null;
      }

      return data as ConversationSummary | null;
    },
    enabled: !!leadId,
  });
}

/**
 * Hook para gerar/regenerar resumo da conversa
 */
export function useGenerateSummary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, forceRegenerate = false }: { leadId: string; forceRegenerate?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("summarize-conversation", {
        body: {
          lead_id: leadId,
          force_regenerate: forceRegenerate,
        },
      });

      if (error) {
        throw error;
      }

      return data as ConversationSummary;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["conversation-summary", variables.leadId] });
    },
  });
}

/**
 * Hook combinado para buscar histórico completo com resumo
 */
export function useFullConversationData(leadId: string | null) {
  const historyQuery = useConversationHistory(leadId);
  const summaryQuery = useConversationSummary(leadId);

  return {
    history: historyQuery.data,
    summary: summaryQuery.data,
    isLoading: historyQuery.isLoading || summaryQuery.isLoading,
    isError: historyQuery.isError || summaryQuery.isError,
    refetch: () => {
      historyQuery.refetch();
      summaryQuery.refetch();
    },
  };
}
