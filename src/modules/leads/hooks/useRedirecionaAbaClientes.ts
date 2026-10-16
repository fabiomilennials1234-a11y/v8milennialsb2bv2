import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { CLASSIFICACAO_TODAS } from "../lib/lead-classificacao";
import {
  CARTEIRA_PERSIST_KEY,
  CLASSIFICACAO_DA_CARTEIRA,
  DEFAULT_CARTEIRA_FILTERS,
  carteiraFiltersFromLeads,
  carteiraRedirectTarget,
  type CarteiraFilterState,
} from "../lib/carteira-route";

type LeadsFilterShape = Partial<Record<keyof CarteiraFilterState, unknown>> & {
  filterClassificacao?: string;
};

/**
 * Redirect da antiga aba Clientes de `/leads` para `/carteira`.
 *
 * A carteira saiu de `/leads` (CTO 2026-10-16), mas `"cliente"` ainda chega ao
 * estado da lista por três portas: estado persistido de antes da mudança,
 * visão salva (`?view=` ou aplicada no seletor) e qualquer escrita futura no
 * estado. Todas passam por `filterClassificacao` e viram UM redirect.
 *
 * Ordem importa: (1) os filtros que a aba mostrava vão para o estado da
 * Carteira; (2) o estado de Leads volta para a aba padrão — sem isso, a
 * próxima visita a `/leads` redirecionaria de novo (loop) ou abriria numa aba
 * que não existe mais; (3) `replace`, para o "voltar" do navegador não cair de
 * novo no redirect. `?lead=`/`?comment=` viajam junto.
 *
 * Mora num hook (e não solto em `Leads.tsx`) para ser testável sem montar a
 * página inteira. Precisa estar dentro do Router — `useNavigate` fora dele
 * derruba o app (tela branca).
 *
 * Trava: depois que o redirect dispara, devolve `true` até desmontar. O reset
 * para `"all"` (passo 2) re-renderiza a página ANTES de `/carteira` assumir;
 * sem a trava esse commit pintaria a lista, buscaria `useLeads("all")` à toa e
 * reabriria o `?lead=` no painel de Leads. Também não depende de o router
 * tratar o `navigate` como transition.
 *
 * @returns `true` desde que `"cliente"` apareceu — a página não pinta.
 */
export function useRedirecionaAbaClientes<S extends LeadsFilterShape>(
  filterClassificacao: string,
  filterState: S,
  setFilterState: Dispatch<SetStateAction<S>>,
): boolean {
  const navigate = useNavigate();
  const { search } = useLocation();
  // Só escreve: é por aqui que os filtros da aba antiga viajam para a Carteira.
  const [, setCarteiraFilters] = usePersistedState(CARTEIRA_PERSIST_KEY, DEFAULT_CARTEIRA_FILTERS);
  const pedeCarteira = filterClassificacao === CLASSIFICACAO_DA_CARTEIRA;
  // Estado (não ref): sai no MESMO lote do reset do passo 2, então o commit
  // seguinte já lê a trava.
  const [disparou, setDisparou] = useState(false);

  useEffect(() => {
    if (!pedeCarteira || disparou) return;
    setDisparou(true);
    setCarteiraFilters(carteiraFiltersFromLeads(filterState));
    setFilterState((f) => ({ ...f, filterClassificacao: CLASSIFICACAO_TODAS }));
    navigate(carteiraRedirectTarget(new URLSearchParams(search)), { replace: true });
    // Dispara na transição para "cliente"; o resto é lido no instante dela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedeCarteira]);

  return pedeCarteira || disparou;
}
