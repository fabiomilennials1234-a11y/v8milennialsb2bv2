import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Ids das linhas da agenda que são MINHAS mas não cabem em `created_by`.
 *
 * `get_agenda_events` projeta um dono só por linha, e a projeção perde gente:
 *
 * - **`meetings`** — devolve `m.created_by`, o criador. Quem foi CONVIDADO não
 *   aparece em lugar nenhum do retorno, e a RPC não toca
 *   `meeting_participants`. Sem isto, a reunião marcada PARA a pessoa some da
 *   agenda dela — justamente a que ela precisa ver.
 * - **`pipe_confirmacao`** — devolve `COALESCE(closer_id, sdr_id)`. Quando os
 *   dois estão preenchidos (o `webhook-confirmacao` manda ambos), o closer
 *   ganha e a **SDR perde** a reunião que ela marcou.
 *
 * As duas chaves são `team_members.id`.
 */
export function useMyAgendaOwnership(teamMemberId: string | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["agenda-ownership", organizationId, teamMemberId],
    queryFn: async (): Promise<Set<string>> => {
      const meus = new Set<string>();
      if (!teamMemberId) return meus;

      // `meeting_participants` e `pipe_confirmacao` não estão nos types
      // gerados (mesma situação de `useMeetings`): o cast por "leads" satisfaz
      // o builder sem afrouxar o shape, recuperado logo abaixo.
      const from = (t: string) => supabase.from(t as "leads");

      // Falha aqui não pode esvaziar a agenda: sem a lista, o recorte cai no
      // dono projetado, que é o comportamento anterior — degrada, não quebra.
      const [participacoes, comoSdr] = await Promise.all([
        from("meeting_participants")
          .select("meeting_id")
          .eq("team_member_id", teamMemberId)
          .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as Array<{ meeting_id: string }>))),
        from("negocio_projetado")
          .select("id")
          .eq("funil_sistema", "confirmacao")
          .eq("organization_id", organizationId as string)
          .eq("sdr_id", teamMemberId)
          .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as Array<{ id: string }>))),
      ]);

      for (const p of participacoes) meus.add(p.meeting_id);
      for (const c of comoSdr) meus.add(c.id);
      return meus;
    },
    enabled: isReady && !!organizationId && !!teamMemberId,
    staleTime: 60_000,
  });
}
