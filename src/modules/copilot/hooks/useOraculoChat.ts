import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface UseOraculoChatOptions {
  month?: number;
  year?: number;
}

export function useOraculoChat(options?: UseOraculoChatOptions) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const { data: rateLimit } = useQuery({
    queryKey: ["oraculo-limit", user?.id],
    queryFn: async () => {
      if (!user?.id) return { used: 0, remaining: 3, limit: 3 };
      const { data, error } = await supabase.rpc("check_oraculo_limit", {
        p_user_id: user.id,
      });
      if (error) return { used: 0, remaining: 3, limit: 3 };
      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return raw as { used: number; remaining: number; limit: number };
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  const sendMessage = useCallback(async (question: string) => {
    if (!user?.id || !organizationId) return;
    if ((rateLimit?.remaining ?? 0) <= 0) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("oraculo-comercial", {
        body: {
          mode: "chat",
          question,
          user_id: user.id,
          organization_id: organizationId,
          ...(options?.month && options?.year ? { month: options.month, year: options.year } : {}),
        },
      });

      if (error) throw error;
      if (data?.error) {
        if (data.error === "limit_exceeded") {
          queryClient.invalidateQueries({ queryKey: ["oraculo-limit"] });
          throw new Error("Você atingiu o limite de consultas diárias.");
        }
        throw new Error(data.error);
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.response || data.tarefa || "Sem resposta",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      queryClient.invalidateQueries({ queryKey: ["oraculo-limit"] });
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: err?.message || "Erro ao consultar o Oráculo. Tente novamente.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, organizationId, rateLimit?.remaining, queryClient, options?.month, options?.year]);

  return {
    messages,
    isLoading,
    isOpen,
    setIsOpen,
    sendMessage,
    rateLimit: rateLimit ?? { used: 0, remaining: 3, limit: 3 },
  };
}
