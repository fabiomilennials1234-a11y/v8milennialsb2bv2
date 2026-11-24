import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useCanDo, useCurrentTeamMember, useOrganization } from "@/modules/identity";
import { diaBrt, mapearResumo, type ResumoSemana } from "../lib/boas-vindas-semana";

/** O dia de Brasília, relido quando a aba volta ao foco (ver `useBoasVindasSemana`). */
function useDiaBrt(): string {
  const [dia, setDia] = useState(() => diaBrt());
  useEffect(() => {
    const reler = () => setDia(diaBrt());
    const aoVoltar = () => {
      if (document.visibilityState === "visible") reler();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", reler);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", reler);
    };
  }, []);
  return dia;
}

/**
 * O resumo da semana anterior da org do usuário, entregue UMA vez por semana.
 *
 * ── CHAMAR CONSOME A SEMANA ──────────────────────────────────────────────────
 * `boas_vindas_semana_reivindicar` marca "já viu" no mesmo instante em que
 * entrega. Por isso a chamada só acontece quando a abertura VAI poder aparecer:
 *
 *   · `metrics.view` — a permissão que tranca a tela de Métricas. Quem não pode
 *     ver receita no painel não vê receita na abertura, e nada é consumido.
 *
 * Master e gestor de portfólio também recebem: entram como admin (membro
 * virtual) e ganham a abertura uma vez por org, por semana, como qualquer usuário.
 *
 * O resultado fica em cache por DIA (Brasília) e não para sempre na sessão. Cache
 * eterno, com o app aberto desde a sexta ou o domingo, guardava o `nao_e_segunda`
 * até a pessoa recarregar, e a segunda passava sem abertura. O dia só é relido
 * quando a aba volta ao foco: virar a meia-noite com o app aberto não dispara a
 * abertura do nada. Dentro do mesmo dia nada se repete (devolveria `ja_vista`),
 * e a abertura que já está tocando vive no estado do gate, não neste cache.
 */
export function useBoasVindasSemana() {
  const dia = useDiaBrt();
  const { user } = useAuth();
  const { organizationId, isReady } = useOrganization();
  const { data: membro } = useCurrentTeamMember();
  const podeVerMetricas = useCanDo("metrics.view");

  const habilitado = Boolean(
    user?.id && isReady && organizationId && membro && !podeVerMetricas.isLoading && podeVerMetricas.allowed,
  );

  return useQuery<ResumoSemana | null>({
    queryKey: ["boas-vindas-semana", user?.id, organizationId, dia],
    enabled: habilitado,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "boas_vindas_semana_reivindicar" as never,
        { p_org_id: organizationId } as never,
      );
      if (error) {
        // Decoração nunca vira erro na cara do usuário: sem animação, e só.
        console.error("[boas-vindas-semana] falha ao reivindicar:", error.message);
        return null;
      }
      return mapearResumo(data);
    },
  });
}
