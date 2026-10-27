/**
 * Cliente tipado das RPCs da Lista Fria.
 *
 * FORA de `Database["Functions"]` de propósito, como a Cobrança (ver
 * `modules/cobranca/lib/rpc.ts`): somar entradas ao catálogo estoura o limite
 * de profundidade do TS (TS2589) em arquivos que usam `supabase.rpc.bind`.
 * A chamada é no OBJETO — a referência solta perde o `this.rest`.
 */
import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface FuncoesDaListaFria {
  lista_fria_saldo: { Args: { p_org: string }; Returns: number };
  lista_fria_busca_criar: {
    Args: { p_org: string; p_fonte: string; p_params: Json; p_creditos: number };
    Returns: string;
  };
  lista_fria_busca_cancelar: { Args: { p_busca: string }; Returns: undefined };
  lista_fria_resultados_selecionar: {
    Args: { p_busca: string; p_ids: string[] | null; p_selecionado: boolean };
    Returns: number;
  };
  // { importados, ja_eram_leads, restantes }
  lista_fria_importar: { Args: { p_busca: string; p_limite?: number }; Returns: Json };
}

type Rpc = <F extends keyof FuncoesDaListaFria>(
  fn: F,
  args: FuncoesDaListaFria[F]["Args"],
) => PromiseLike<{ data: FuncoesDaListaFria[F]["Returns"] | null; error: PostgrestError | null }>;

const cliente = supabase as unknown as { rpc: Rpc };

export function rpcListaFria<F extends keyof FuncoesDaListaFria>(fn: F, args: FuncoesDaListaFria[F]["Args"]) {
  return cliente.rpc(fn, args);
}
