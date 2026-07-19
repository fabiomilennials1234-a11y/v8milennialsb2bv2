/**
 * Hook de identidade do Gestor de Portfólio (scoped master — ADR-0021).
 *
 * Espelha `useMasterAuth`: lê a linha ativa em `gestores` do usuário atual.
 * O Gestor é um ator fora de `team_members`; este hook é o gate que diz se o
 * usuário logado é um Gestor ativo. Usado pelo boot gate, pelo `GestorRoute`,
 * pelo `useOrgSwitcher` (lista as orgs vinculadas) e pelo `useCurrentTeamMember`
 * (cunha o virtual member `admin` nas orgs vinculadas).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "../../auth/contexts/AuthContext";
import type { GestorRow } from "../types";

export function useGestor() {
  const { user } = useAuth();

  const { data: gestor, isLoading, error } = useQuery({
    queryKey: ["gestor-auth", user?.id],
    queryFn: async (): Promise<GestorRow | null> => {
      if (!user?.id) return null;

      // `gestores` ausente do types gerado (drift repo↔prod) → cast (ver types.ts).
      const { data, error } = await supabase
        .from("gestores" as any)
        .select("id, user_id, is_active, notes, created_at")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        // PGRST116 = not found, esperado para não-gestores.
        if (error.code === "PGRST116") return null;
        console.error("Error checking gestor status:", error);
        return null;
      }

      return (data as unknown as GestorRow) ?? null;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutos
    retry: false,
  });

  return {
    isGestor: !!gestor,
    gestorId: gestor?.id ?? null,
    gestor: gestor ?? null,
    isLoading,
    error: error ?? null,
  };
}
