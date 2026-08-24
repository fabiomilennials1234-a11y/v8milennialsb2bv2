import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization, type TeamMember } from "@/modules/identity";
import { useTeamMembers } from "@/modules/identity";
import type { AgendaEvent } from "@/modules/engagement";
import { useComandoScope } from "@/modules/analytics/hooks/useComandoScope";
import { eventoDaAgendaVisivel } from "@/modules/analytics/lib/comando-escopo";

/**
 * Comando — "Próximas agendas", já recortada por usuário.
 *
 * ─── Por que um hook novo em vez de um parâmetro no `useAgendaEvents` ───────
 *
 * `useAgendaEvents` serve a tela `/agenda`, que deve continuar mostrando a
 * operação inteira (decisão do usuário em 24/08). Um parâmetro ali seria
 * lido por duas telas com regras diferentes, e a primeira pessoa a mexer numa
 * quebraria a outra. Aqui o recorte é a razão de existir do hook.
 *
 * O peso é baixo: a RPC `get_comando_agenda_events` COMPÕE sobre
 * `get_agenda_events` em vez de reimplementá-la — se a agenda ganhar uma sexta
 * fonte, este caminho acompanha sozinho. Ver o cabeçalho de `20270825000020`
 * para o motivo (o corpo da função no PROD tem 5 fontes e o do repo tem 4;
 * recriá-la a partir do repo apagaria a quinta).
 *
 * ─── O caminho degradado ────────────────────────────────────────────────────
 *
 * Se a RPC nova ainda não existe no banco, caímos em `get_agenda_events` e
 * aplicamos a MESMA regra no cliente. Isso é remendo, não barreira: o dado
 * ainda atravessa a rede. Existe só para o card não morrer com `PGRST202`
 * entre o deploy do front e o apply da migration — que foi como um parâmetro
 * novo derrubou o board inteiro na #1774. `isDegraded` deixa isso visível na
 * tela em vez de escondido.
 */

export interface ComandoAgendaEvent extends AgendaEvent {
  /**
   * Dono normalizado para `team_members.id` — a única coluna segura para
   * comparar pessoa, porque `created_by` mistura `auth.users.id` (fonte
   * `meeting`) com `team_members.id` (as outras quatro).
   */
  owner_team_member_id: string | null;
  /** Resolvido no cliente a partir de `useTeamMembers`; `null` quando órfão. */
  owner_name: string | null;
}

export interface ComandoAgendaResult {
  data: ComandoAgendaEvent[];
  isLoading: boolean;
  isError: boolean;
  isDegraded: boolean;
  isAdmin: boolean;
  refetch: () => void;
}

interface PgLikeError {
  code?: string;
  message?: string;
}

/** A RPC nova ainda não está no `types.ts` (gerado do PROD). */
type ComandoAgendaRpc = (
  fn: "get_comando_agenda_events",
  args: { p_organization_id: string; p_start: string; p_end: string },
) => PromiseLike<{
  data: (AgendaEvent & { owner_team_member_id: string | null })[] | null;
  error: PgLikeError | null;
}>;

function isMissingFunctionError(error: unknown): boolean {
  const e = error as PgLikeError;
  if (e?.code === "PGRST202" || e?.code === "42883") return true;
  return /could not find the function|does not exist/i.test(e?.message ?? "");
}

interface Buscado {
  eventos: (AgendaEvent & { owner_team_member_id: string | null })[];
  degraded: boolean;
}

async function buscar(
  organizationId: string,
  inicio: Date,
  fim: Date,
  escopo: "meu" | "tudo",
  meuTeamMemberId: string | null,
  meuUserId: string | null,
): Promise<Buscado> {
  const chamar = supabase.rpc as unknown as ComandoAgendaRpc;
  const { data, error } = await chamar("get_comando_agenda_events", {
    p_organization_id: organizationId,
    p_start: inicio.toISOString(),
    p_end: fim.toISOString(),
  });

  if (!error) {
    return { eventos: data ?? [], degraded: false };
  }
  if (!isMissingFunctionError(error)) throw error;

  // ── Degradado: banco sem a migration 20270825000020 ───────────────────────
  const { data: base, error: baseError } = await supabase.rpc(
    "get_agenda_events",
    {
      p_organization_id: organizationId,
      p_start: inicio.toISOString(),
      p_end: fim.toISOString(),
    },
  );
  if (baseError) throw baseError;

  const brutos = (base ?? []) as unknown as AgendaEvent[];

  return {
    degraded: true,
    eventos: brutos
      .filter((e) =>
        eventoDaAgendaVisivel(e, meuTeamMemberId, meuUserId, escopo),
      )
      .map((e) => ({
        ...e,
        // Mesma normalização que a RPC faria, para a UI não ver diferença.
        owner_team_member_id:
          e.source === "meeting" ? null : (e.created_by ?? null),
      })),
  };
}

export function useComandoAgenda(
  inicio: Date,
  fim: Date,
): ComandoAgendaResult {
  const { organizationId, isReady: orgReady } = useOrganization();
  const { escopo, isAdmin, meuTeamMemberId, meuUserId, isReady } =
    useComandoScope();
  // Só o admin precisa do nome de terceiros; para o vendedor a lista é dele.
  const { data: membros } = useTeamMembers();

  const query = useQuery({
    queryKey: [
      "comando",
      "agenda",
      organizationId,
      inicio.toISOString(),
      fim.toISOString(),
      escopo,
    ],
    queryFn: () =>
      buscar(
        organizationId as string,
        inicio,
        fim,
        escopo,
        meuTeamMemberId,
        meuUserId,
      ),
    enabled: orgReady && isReady && !!organizationId,
    staleTime: 30_000,
  });

  const nomePorId = new Map<string, string>(
    ((membros ?? []) as TeamMember[])
      .filter((m) => !!m.id && !!m.name)
      .map((m) => [m.id, m.name as string]),
  );

  return {
    data: (query.data?.eventos ?? []).map((e) => ({
      ...e,
      owner_name:
        (e.owner_team_member_id
          ? nomePorId.get(e.owner_team_member_id)
          : undefined) ??
        // A RPC já traz `creator_name` para todas as 5 fontes, inclusive a
        // `meeting` (que resolve pela ponte `team_members.user_id`). Serve de
        // rede quando o membro saiu do time e sumiu de `useTeamMembers`.
        e.creator_name ??
        null,
    })),
    isLoading: query.isLoading,
    isError: query.isError,
    isDegraded: query.data?.degraded === true,
    isAdmin,
    refetch: () => void query.refetch(),
  };
}
