import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

import { type Busca, type Resultado, type Saldos, buscaEstaAberta, parseBusca, parseResultado, parseSaldos } from "../lib/tipos";
import { rpcListaFria } from "../lib/rpc";

/**
 * Leitura da Lista Fria. Tudo passa pela RLS (flag + lista_fria.view).
 *
 * Chave raiz `["lista-fria", org]`: toda escrita invalida a raiz — são poucas
 * linhas e saldo velho numa tela de créditos custa mais que um refetch.
 */
export const CHAVE_LISTA_FRIA = "lista-fria";
export const TAMANHO_DA_PAGINA = 50;
/** Enquanto houver busca rodando, a tela confere o banco a cada 4 s. */
const INTERVALO_DA_BUSCA_ABERTA_MS = 4_000;

/** Os dois saldos: normal (Maps, CNPJ) e Meta (Instagram). */
export function useSaldos(opcoes: { enabled?: boolean } = {}) {
  const { organizationId } = useOrganization();
  return useQuery<Saldos>({
    queryKey: [CHAVE_LISTA_FRIA, organizationId, "saldos"],
    enabled: !!organizationId && opcoes.enabled !== false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await rpcListaFria("lista_fria_saldos", { p_org: organizationId as string });
      if (error) throw error;
      return parseSaldos(data);
    },
  });
}

export function useBuscas(opcoes: { enabled?: boolean } = {}) {
  const { organizationId } = useOrganization();
  return useQuery<Busca[]>({
    queryKey: [CHAVE_LISTA_FRIA, organizationId, "buscas"],
    enabled: !!organizationId && opcoes.enabled !== false,
    staleTime: 10_000,
    refetchInterval: (q) => (q.state.data?.some(buscaEstaAberta) ? INTERVALO_DA_BUSCA_ABERTA_MS : false),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lista_fria_buscas")
        .select("*")
        .eq("organization_id", organizationId as string)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []).map(parseBusca);
    },
  });
}

export function useBusca(buscaId: string | undefined) {
  const { organizationId } = useOrganization();
  return useQuery<Busca | null>({
    queryKey: [CHAVE_LISTA_FRIA, organizationId, "busca", buscaId],
    enabled: !!organizationId && !!buscaId,
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data && buscaEstaAberta(q.state.data) ? INTERVALO_DA_BUSCA_ABERTA_MS : false),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lista_fria_buscas")
        .select("*")
        .eq("organization_id", organizationId as string)
        .eq("id", buscaId as string)
        .maybeSingle();
      if (error) throw error;
      return data ? parseBusca(data) : null;
    },
  });
}

export interface FiltrosDaRevisao {
  busca: string;
  somenteNovos: boolean;
  comEmail: boolean;
  comTelefone: boolean;
  verificados: boolean;
  pagina: number;
}

export const FILTROS_DA_REVISAO: FiltrosDaRevisao = {
  busca: "",
  somenteNovos: false,
  comEmail: false,
  comTelefone: false,
  verificados: false,
  pagina: 0,
};

/** Tira o que quebraria o `ilike` do PostgREST: curinga e separadores do `or()`. */
export function termoSeguro(termo: string): string {
  return termo.replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);
}

export function useResultados(buscaId: string | undefined, filtros: FiltrosDaRevisao) {
  const { organizationId } = useOrganization();
  return useQuery<{ linhas: Resultado[]; total: number }>({
    queryKey: [CHAVE_LISTA_FRIA, organizationId, "resultados", buscaId, filtros],
    enabled: !!organizationId && !!buscaId,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    queryFn: async () => {
      let q = supabase
        .from("lista_fria_resultados")
        .select("*", { count: "exact" })
        .eq("organization_id", organizationId as string)
        .eq("busca_id", buscaId as string);
      if (filtros.somenteNovos) q = q.eq("ja_e_lead", false);
      if (filtros.comEmail) q = q.not("email", "is", null);
      if (filtros.comTelefone) q = q.not("telefone", "is", null);
      if (filtros.verificados) q = q.eq("qualidade", "verificado");
      const termo = termoSeguro(filtros.busca);
      if (termo) q = q.ilike("nome", `%${termo}%`);
      const de = filtros.pagina * TAMANHO_DA_PAGINA;
      const { data, error, count } = await q
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(de, de + TAMANHO_DA_PAGINA - 1);
      if (error) throw error;
      return { linhas: (data ?? []).map(parseResultado), total: count ?? 0 };
    },
  });
}

/** O que a barra de baixo da revisão promete: quantos vão para os leads. */
export function usePendentesDaImportacao(buscaId: string | undefined) {
  const { organizationId } = useOrganization();
  return useQuery<{ selecionados: number; novos: number }>({
    queryKey: [CHAVE_LISTA_FRIA, organizationId, "pendentes", buscaId],
    enabled: !!organizationId && !!buscaId,
    staleTime: 5_000,
    queryFn: async () => {
      const base = () =>
        supabase
          .from("lista_fria_resultados")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId as string)
          .eq("busca_id", buscaId as string)
          .eq("ja_e_lead", false)
          .is("lead_id", null);
      const [sel, todos] = await Promise.all([base().eq("selecionado", true), base()]);
      if (sel.error) throw sel.error;
      if (todos.error) throw todos.error;
      return { selecionados: sel.count ?? 0, novos: todos.count ?? 0 };
    },
  });
}
