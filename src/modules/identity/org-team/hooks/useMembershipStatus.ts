/**
 * useDeactivatedMembership — a pessoa TEM vínculo, mas ele está desativado?
 *
 * `useCurrentTeamMember` filtra `is_active = true`, então um membro desativado
 * volta como `null` — indistinguível de quem nunca foi vinculado a org nenhuma.
 * O resultado é que quem foi desligado via "Aguardando Ativação / sua conta
 * está sendo configurada", e o ramo "Conta Desativada" do ProtectedRoute era
 * código morto: nunca havia um `teamMember` com `is_active = false` para ele
 * inspecionar.
 *
 * A consulta aqui não depende de org: a policy `team_members_select_own`
 * (`user_id = auth.uid()`) entrega as linhas da própria pessoa mesmo quando
 * todos os vínculos estão desativados — e mesmo quando a org está bloqueada.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "../../auth/contexts/AuthContext";

export function useDeactivatedMembership(enabled = true) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["team_members", "deactivated", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase
        .from("team_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", false)
        .limit(1);

      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: enabled && !!user?.id,
    staleTime: 60 * 1000,
    retry: 1,
  });
}
