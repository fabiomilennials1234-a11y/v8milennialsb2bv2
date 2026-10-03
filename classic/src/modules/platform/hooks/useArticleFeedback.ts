/**
 * useArticleFeedback — o voto "Foi útil?" do usuário num Artigo de Ajuda.
 *
 * Um voto por (artigo, usuário), trocável: o submit faz upsert com conflito em
 * (article_id, user_id). A RLS garante que cada um só lê e mexe no próprio voto;
 * o agregado anônimo é outra história (RPC, fatia B3).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";

const KEY = "help-article-feedback";

export function useArticleFeedback(articleId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const vote = useQuery({
    queryKey: [KEY, articleId, userId],
    enabled: !!articleId && !!userId,
    queryFn: async (): Promise<boolean | null> => {
      const { data, error } = await supabase
        .from("help_article_feedback")
        .select("helpful")
        .eq("article_id", articleId!)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data ? data.helpful : null;
    },
  });

  const submit = useMutation({
    mutationFn: async ({ helpful, reason }: { helpful: boolean; reason?: string | null }) => {
      if (!articleId || !userId) throw new Error("sem artigo ou usuario");
      const { error } = await supabase.from("help_article_feedback").upsert(
        {
          article_id: articleId,
          user_id: userId,
          helpful,
          // Trocar de 👎 para 👍 limpa o motivo (fatia B2).
          reason: helpful ? null : reason ?? null,
        },
        { onConflict: "article_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, articleId, userId] });
    },
  });

  return {
    myVote: vote.data ?? null,
    submit: submit.mutate,
    submitAsync: submit.mutateAsync,
    isPending: submit.isPending,
  };
}
