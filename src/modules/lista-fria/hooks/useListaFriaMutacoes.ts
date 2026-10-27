import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useOrganization } from "@/modules/identity";

import { rpcListaFria } from "../lib/rpc";
import type { FonteDaBusca } from "../lib/tipos";
import { CHAVE_LISTA_FRIA } from "./useListaFriaDados";

/**
 * Escrita da Lista Fria: só RPC (as tabelas não têm GRANT de escrita).
 *
 * Os hooks lançam o erro ORIGINAL do PostgREST (com `code`); quem mostra ao
 * usuário usa `notifyError(err, { fallback, message: recusaDaListaFria(err) })`.
 */

function useInvalidarListaFria() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  return () => qc.invalidateQueries({ queryKey: [CHAVE_LISTA_FRIA, organizationId] });
}

export type AlvoDaBusca =
  | { fonte: Extract<FonteDaBusca, "maps">; nicho: string; cidade: string }
  | { fonte: Extract<FonteDaBusca, "instagram">; url: string };

export function useCriarBusca() {
  const { organizationId } = useOrganization();
  const invalidar = useInvalidarListaFria();
  return useMutation({
    mutationFn: async (v: { alvo: AlvoDaBusca; creditos: number }) => {
      const params =
        v.alvo.fonte === "maps"
          ? { nicho: v.alvo.nicho.trim(), cidade: v.alvo.cidade.trim() }
          : { url: v.alvo.url.trim() };
      const { data, error } = await rpcListaFria("lista_fria_busca_criar", {
        p_org: organizationId as string,
        p_fonte: v.alvo.fonte,
        p_params: params,
        p_creditos: v.creditos,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidar,
  });
}

/** "Parar e ficar com o que achou" (em andamento) ou cancelar (na fila). */
export function usePararBusca() {
  const invalidar = useInvalidarListaFria();
  return useMutation({
    mutationFn: async (buscaId: string) => {
      const { error } = await rpcListaFria("lista_fria_busca_cancelar", { p_busca: buscaId });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useSelecionarResultados() {
  const invalidar = useInvalidarListaFria();
  return useMutation({
    mutationFn: async (v: { buscaId: string; ids: string[] | null; selecionado: boolean }) => {
      const { data, error } = await rpcListaFria("lista_fria_resultados_selecionar", {
        p_busca: v.buscaId,
        p_ids: v.ids,
        p_selecionado: v.selecionado,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: invalidar,
  });
}

export interface ResultadoDaImportacao {
  importados: number;
  jaEramLeads: number;
}

const LOTE = 200;
/** Teto de voltas: 100 voltas × 200 = 20 mil contatos, mais do que a busca pode ter. */
const MAX_VOLTAS = 100;

/**
 * Importa tudo o que está selecionado, em lotes: cada chamada cabe no timeout
 * da API e a RPC diz quantos faltam. Para na primeira recusa — o que já entrou
 * entrou, e a tela mostra o que ficou.
 */
export function useImportarBusca() {
  const invalidar = useInvalidarListaFria();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (buscaId: string): Promise<ResultadoDaImportacao> => {
      let importados = 0;
      let jaEramLeads = 0;
      for (let volta = 0; volta < MAX_VOLTAS; volta++) {
        const { data, error } = await rpcListaFria("lista_fria_importar", { p_busca: buscaId, p_limite: LOTE });
        if (error) throw error;
        const r = (data ?? {}) as { importados?: number; ja_eram_leads?: number; restantes?: number };
        importados += r.importados ?? 0;
        jaEramLeads += r.ja_eram_leads ?? 0;
        if ((r.restantes ?? 0) === 0) break;
      }
      return { importados, jaEramLeads };
    },
    onSettled: () => {
      invalidar();
      // A aba Lista fria de /leads lê `leads`: precisa ver o que acabou de entrar.
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
