/**
 * Cliente tipado das RPCs da cobrança.
 *
 * As 14 RPCs ficam FORA de `Database["Functions"]` (types.ts) de propósito: o
 * repo tem ~10 chamadas `supabase.rpc.bind(supabase)`, e o `.bind` instancia o
 * genérico de `rpc` sobre o catálogo inteiro de funções. Somar 14 entradas ao
 * catálogo passou o limite de profundidade do TS (TS2589) em arquivos que nada
 * têm a ver com cobrança — medido em 21/10. As tabelas e views continuam no
 * types.ts (o `.from()` não sofre disso).
 *
 * A chamada é no OBJETO (`cliente.rpc`), não numa referência solta: supabase-js
 * lê `this.rest` lá dentro.
 */
import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface FuncoesDaCobranca {
  cobranca_caso_mover: { Args: { p_caso: string; p_etapa: string; p_posicao?: number }; Returns: string };
  cobranca_casos_atribuir: { Args: { p_org: string; p_casos: string[]; p_responsavel: string | null }; Returns: number };
  cobranca_compromisso_encerrar: { Args: { p_compromisso: string; p_status: string }; Returns: string };
  cobranca_compromisso_registrar: {
    Args: { p_caso: string; p_tipo: string; p_parcelas: Json; p_observacao?: string; p_mover_para?: string };
    Returns: string;
  };
  cobranca_contato_registrar: {
    Args: { p_caso: string; p_canal: string; p_resultado: string; p_nota?: string };
    Returns: string;
  };
  cobranca_etapas_garantir: { Args: { p_org: string }; Returns: number };
  cobranca_importar: { Args: { p_org: string; p_linhas: Json; p_dry_run?: boolean }; Returns: Json };
  cobranca_inadimplente_arquivar: { Args: { p_inadimplente: string; p_motivo: string }; Returns: string };
  cobranca_inadimplente_salvar: { Args: { p_org: string; p_id: string | null; p_dados: Json }; Returns: string };
  cobranca_metricas: { Args: { p_org: string; p_hoje?: string }; Returns: Json };
  cobranca_nao_contatar: { Args: { p_inadimplente: string; p_valor: boolean; p_motivo?: string }; Returns: string };
  cobranca_pagamento_registrar: {
    Args: { p_caso: string; p_valor: number; p_pago_em: string; p_titulo?: string };
    Returns: Json;
  };
  cobranca_titulo_cancelar: { Args: { p_titulo: string; p_motivo: string }; Returns: string };
  cobranca_titulo_incluir: { Args: { p_inadimplente: string; p_dados: Json }; Returns: string };
}

export type FuncaoDaCobranca = keyof FuncoesDaCobranca;

type Rpc = <F extends FuncaoDaCobranca>(
  fn: F,
  args: FuncoesDaCobranca[F]["Args"],
) => PromiseLike<{ data: FuncoesDaCobranca[F]["Returns"] | null; error: PostgrestError | null }>;

const cliente = supabase as unknown as { rpc: Rpc };

export function rpcCobranca<F extends FuncaoDaCobranca>(fn: F, args: FuncoesDaCobranca[F]["Args"]) {
  return cliente.rpc(fn, args);
}
