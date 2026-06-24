/**
 * Estado do product tour: "o usuário já viu?" + marcar como visto.
 *
 * Persistência em duas camadas:
 *  - Supabase `profiles.product_tour_completed_at` (fonte de verdade, por usuário)
 *  - localStorage `tour-intro-<userId>` (fallback/otimista, evita "piscar" o tour
 *    antes do fetch e funciona offline). O prefixo `tour-intro-` é limpo no signOut
 *    (AuthContext) para não vazar entre contas no mesmo navegador.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const tourLsKey = (userId: string) => `tour-intro-${userId}`;

export function useTourState() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["product-tour", userId],
    enabled: !!userId,
    staleTime: Infinity,
    queryFn: async () => {
      // Fallback rápido: se já marcamos localmente, nem consulta o banco.
      try {
        if (localStorage.getItem(tourLsKey(userId!))) return { seen: true };
      } catch {
        /* localStorage indisponível */
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("product_tour_completed_at")
        .eq("id", userId!)
        .single();
      if (error) throw error;
      return { seen: !!data?.product_tour_completed_at };
    },
  });

  const markSeen = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      try {
        localStorage.setItem(tourLsKey(userId), new Date().toISOString());
      } catch {
        /* localStorage indisponível */
      }
      const { error } = await supabase
        .from("profiles")
        .update({ product_tour_completed_at: new Date().toISOString() })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-tour", userId] });
    },
  });

  return {
    hasSeen: data?.seen ?? false,
    isLoading,
    markSeen: () => markSeen.mutate(),
  };
}
