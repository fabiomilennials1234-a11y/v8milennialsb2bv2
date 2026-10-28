import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useDebounce } from "@/shared/hooks/useDebounce";
import type { AgendaEvent } from "./useAgendaEvents";

/** Mesmo debounce dos outros campos de busca do app (ver LeadPorFunilPicker). */
export const AGENDA_SEARCH_DEBOUNCE_MS = 300;

/** Abaixo disto o termo casaria com a agenda inteira — o banco também recusa. */
export const AGENDA_SEARCH_MIN_CHARS = 2;

/** Teto pedido ao banco (que ainda aplica o seu, de 100). */
export const AGENDA_SEARCH_LIMIT = 50;

/** `PGRST202`: a função não existe no schema cache — migration não aplicada. */
function isMissingFunctionError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return (
    e?.code === "PGRST202" ||
    /Could not find the function|schema cache/i.test(e?.message ?? "")
  );
}

/**
 * Busca global na Agenda — "este cliente tem algo marcado?", SEM janela de
 * datas. Procura por título e por nome, empresa e código ERP do lead.
 *
 * Passa por `search_agenda_events`, que aplica no BANCO o mesmo recorte de
 * visibilidade de `get_agenda_events_scoped` (admin / `agenda.view_all` vê a
 * org; senão os meus + sem dono + convidado). Nunca leia `meetings` direto
 * daqui: o RLS dela é só por organização.
 *
 * O debounce mora aqui, não no campo: quem consome recebe `isPending` honesto
 * (digitando OU buscando) e nunca vê o resultado do termo anterior como se
 * fosse do atual.
 */
export function useAgendaSearch(rawTerm: string) {
  const { organizationId, isReady } = useOrganization();

  const typed = rawTerm.trim();
  const term = useDebounce(typed, AGENDA_SEARCH_DEBOUNCE_MS);

  const typedLongEnough = typed.length >= AGENDA_SEARCH_MIN_CHARS;
  const termLongEnough = term.length >= AGENDA_SEARCH_MIN_CHARS;

  const query = useQuery({
    queryKey: ["agenda-search", organizationId, term],
    queryFn: async (): Promise<AgendaEvent[]> => {
      const { data, error } = await supabase.rpc("search_agenda_events", {
        p_organization_id: organizationId as string,
        p_query: term,
        p_limit: AGENDA_SEARCH_LIMIT,
      });
      if (error) throw error;
      return (data ?? []) as unknown as AgendaEvent[];
    },
    enabled: isReady && !!organizationId && termLongEnough,
    staleTime: 30_000,
    // Função ausente não melhora tentando de novo.
    retry: (failureCount, error) =>
      !isMissingFunctionError(error) && failureCount < 1,
  });

  /** Há uma busca em curso para o que está digitado? */
  const isActive = typedLongEnough;
  /** Digitando (debounce não venceu) ou esperando o banco. */
  const isPending =
    isActive && (typed !== term || query.isLoading || !isReady);

  return {
    /** Termo já debounced (o que foi de fato consultado). */
    term,
    isActive,
    isPending,
    isError: isActive && typed === term && query.isError,
    isUnavailable:
      isActive && query.isError && isMissingFunctionError(query.error),
    events: isActive && typed === term ? (query.data ?? []) : [],
    refetch: query.refetch,
  };
}
