/**
 * Agregado anônimo do Feedback do Artigo, para quem escreve (fatia B3).
 *
 * Uma chamada ao RPC get_help_article_feedback_summaries devolve, por artigo que
 * o chamador possui (master → globais; admin → da sua org), 👍/👎 + os motivos
 * dos 👎 — sem user_id. Artigo sem feedback não aparece no mapa.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FeedbackSummary {
  up: number;
  down: number;
  reasons: string[];
}

const KEY = "help-feedback-summaries";

export function useHelpFeedbackSummaries() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<Record<string, FeedbackSummary>> => {
      const { data, error } = await supabase.rpc("get_help_article_feedback_summaries");
      if (error) throw error;
      const map: Record<string, FeedbackSummary> = {};
      for (const row of data ?? []) {
        map[row.article_id] = {
          up: row.helpful_up ?? 0,
          down: row.helpful_down ?? 0,
          reasons: row.reasons ?? [],
        };
      }
      return map;
    },
  });
}
