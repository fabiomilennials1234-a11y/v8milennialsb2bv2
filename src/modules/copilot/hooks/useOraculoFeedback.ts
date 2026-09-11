import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type {
  OraculoFeedbackReason,
  OraculoFeedbackValue,
} from "../components/oraculo/OraculoFeedbackControl";

interface FeedbackRecord extends OraculoFeedbackValue {
  id: string;
}

interface FeedbackState {
  conversation: FeedbackRecord | null;
  responses: Record<string, FeedbackRecord>;
}

type FeedbackTarget =
  | { type: "response"; turnId: string }
  | { type: "conversation"; conversationId: string };

const EMPTY: FeedbackState = { conversation: null, responses: {} };

export function useOraculoFeedback(
  organizationId: string | null,
  conversationId: string | null,
) {
  const queryClient = useQueryClient();
  const queryKey = ["oraculo-feedback", organizationId, conversationId];
  const state = useQuery({
    queryKey,
    enabled: !!organizationId && !!conversationId,
    queryFn: async (): Promise<FeedbackState> => {
      const { data, error } = await supabase.functions.invoke<FeedbackState>("oraculo-feedback", {
        body: {
          acao: "estado",
          organization_id: organizationId,
          conversa_id: conversationId,
        },
      });
      if (error) throw error;
      return data ?? EMPTY;
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ target, value }: { target: FeedbackTarget; value: OraculoFeedbackValue }) => {
      if (!organizationId) throw new Error("organizacao_ausente");
      const { data, error } = await supabase.functions.invoke<{ id: string }>("oraculo-feedback", {
        body: {
          acao: "avaliar",
          organization_id: organizationId,
          alvo: target.type === "response" ? "resposta" : "conversa",
          avaliacao: value.rating === "positive" ? "positiva" : "negativa",
          motivo: value.reason,
          comentario: value.comment,
          turno_id: target.type === "response" ? target.turnId : undefined,
          conversa_id: target.type === "conversation" ? target.conversationId : undefined,
        },
      });
      if (error) throw error;
      if (!data?.id) throw new Error("feedback_sem_id");
      return { target, value, id: data.id };
    },
    onSuccess: ({ target, value, id }) => {
      queryClient.setQueryData<FeedbackState>(queryKey, (current) => {
        const next = current ?? EMPTY;
        const record = { ...value, id };
        return target.type === "response"
          ? { ...next, responses: { ...next.responses, [target.turnId]: record } }
          : { ...next, conversation: record };
      });
    },
    onError: () => toast.error("Não consegui salvar o feedback. Tente novamente."),
  });

  return {
    state: state.data ?? EMPTY,
    loading: state.isLoading,
    error: state.isError,
    submitResponse: (turnId: string, value: OraculoFeedbackValue) =>
      mutation.mutate({ target: { type: "response", turnId }, value }),
    submitConversation: (value: OraculoFeedbackValue) => {
      if (conversationId) {
        mutation.mutate({ target: { type: "conversation", conversationId }, value });
      }
    },
    busyTarget: mutation.isPending
      ? mutation.variables?.target.type === "response"
        ? mutation.variables.target.turnId
        : mutation.variables?.target.conversationId ?? null
      : null,
  };
}

export async function recordOraculoSignal(input: {
  organizationId: string;
  event: "briefing_opened" | "proposal_clicked";
  conversationId?: string | null;
  proposalId?: string;
}): Promise<void> {
  await supabase.functions.invoke("oraculo-feedback", {
    body: {
      acao: "sinal",
      organization_id: input.organizationId,
      evento: input.event,
      conversa_id: input.conversationId ?? undefined,
      proposta_id: input.proposalId,
    },
  });
}

export type { OraculoFeedbackReason, OraculoFeedbackValue };
