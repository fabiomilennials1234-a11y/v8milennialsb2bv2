import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Json } from "@/integrations/supabase/types";
import { useOrganization } from "@/modules/identity";

import { normalizarTelefone, soDigitos } from "../lib/documento";
import type { LinhaParaImportar } from "../lib/planilha";
import {
  type CanalDeContato,
  type ResultadoDaImportacao,
  type ResultadoDoContato,
  type TipoDeCompromisso,
  parseImportacao,
} from "../lib/tipos";
import { rpcCobranca } from "../lib/rpc";
import { CHAVE_COBRANCA } from "./useCobrancaDados";

/**
 * Escrita da área de cobrança: só RPC (as tabelas não têm GRANT de escrita).
 *
 * Os hooks lançam o erro ORIGINAL do PostgREST (com `code`); quem mostra ao
 * usuário usa `notifyError(err, { fallback, message: recusaDaCobranca(err) })`.
 * Tudo passa por `rpcCobranca` (lib/rpc.ts), que chama no objeto — a referência solta perde o
 * receiver.
 */

function useInvalidarCobranca() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  return () => qc.invalidateQueries({ queryKey: [CHAVE_COBRANCA, organizationId] });
}

export interface TituloNovo {
  numero?: string;
  descricao?: string;
  valor: number;
  /** `aaaa-mm-dd`. */
  vencimento: string;
}

export interface DadosDoInadimplente {
  nome: string;
  documento?: string;
  telefone?: string;
  email?: string;
  contatoNome?: string;
  cidade?: string;
  observacoes?: string;
  responsavelId?: string | null;
  titulos?: TituloNovo[];
}

function payloadDoInadimplente(d: DadosDoInadimplente): Json {
  return {
    nome: d.nome.trim(),
    documento: soDigitos(d.documento) || null,
    telefone: normalizarTelefone(d.telefone),
    email: d.email?.trim() || null,
    contato_nome: d.contatoNome?.trim() || null,
    cidade: d.cidade?.trim() || null,
    observacoes: d.observacoes?.trim() || null,
    responsavel_id: d.responsavelId || null,
    titulos: (d.titulos ?? []).map((t) => ({
      numero: t.numero?.trim() || null,
      descricao: t.descricao?.trim() || null,
      valor: t.valor,
      vencimento: t.vencimento,
    })),
  } as Json;
}

export function useSalvarInadimplente() {
  const { organizationId } = useOrganization();
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ id, dados }: { id: string | null; dados: DadosDoInadimplente }): Promise<string> => {
      const { data, error } = await rpcCobranca("cobranca_inadimplente_salvar", {
        p_org: organizationId as string,
        p_id: id,
        p_dados: payloadDoInadimplente(dados),
      });
      if (error) throw error;
      return data as string;
    },
    onSettled: invalidar,
  });
}

export function useIncluirTitulo() {
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ inadimplenteId, titulo }: { inadimplenteId: string; titulo: TituloNovo }) => {
      const { data, error } = await rpcCobranca("cobranca_titulo_incluir", {
        p_inadimplente: inadimplenteId,
        p_dados: { ...titulo } as Json,
      });
      if (error) throw error;
      return data as string;
    },
    onSettled: invalidar,
  });
}

export function useCancelarTitulo() {
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ tituloId, motivo }: { tituloId: string; motivo: string }) => {
      const { error } = await rpcCobranca("cobranca_titulo_cancelar", { p_titulo: tituloId, p_motivo: motivo });
      if (error) throw error;
    },
    onSettled: invalidar,
  });
}

/** Dry-run não invalida nada (não gravou); a importação real invalida tudo. */
export function useImportarPlanilha() {
  const { organizationId } = useOrganization();
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ linhas, dryRun }: { linhas: LinhaParaImportar[]; dryRun: boolean }): Promise<ResultadoDaImportacao> => {
      const { data, error } = await rpcCobranca("cobranca_importar", {
        p_org: organizationId as string,
        p_linhas: linhas as unknown as Json,
        p_dry_run: dryRun,
      });
      if (error) throw error;
      return parseImportacao(data);
    },
    onSuccess: (r) => {
      if (!r.dryRun) void invalidar();
    },
  });
}

export function useMoverCaso() {
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ casoId, etapaId, posicao }: { casoId: string; etapaId: string; posicao?: number }) => {
      const { error } = await rpcCobranca("cobranca_caso_mover", {
        p_caso: casoId,
        p_etapa: etapaId,
        p_posicao: posicao,
      });
      if (error) throw error;
    },
    onSettled: invalidar,
  });
}

export function useAtribuirCasos() {
  const { organizationId } = useOrganization();
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ casoIds, responsavelId }: { casoIds: string[]; responsavelId: string | null }): Promise<number> => {
      const { data, error } = await rpcCobranca("cobranca_casos_atribuir", {
        p_org: organizationId as string,
        p_casos: casoIds,
        p_responsavel: responsavelId,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSettled: invalidar,
  });
}

export interface NovoCompromisso {
  casoId: string;
  tipo: TipoDeCompromisso;
  parcelas: { vencimento: string; valor: number }[];
  observacao?: string;
  moverPara?: string | null;
}

export function useRegistrarCompromisso() {
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async (c: NovoCompromisso) => {
      const { error } = await rpcCobranca("cobranca_compromisso_registrar", {
        p_caso: c.casoId,
        p_tipo: c.tipo,
        p_parcelas: c.parcelas as unknown as Json,
        p_observacao: c.observacao?.trim() || undefined,
        p_mover_para: c.moverPara || undefined,
      });
      if (error) throw error;
    },
    onSettled: invalidar,
  });
}

export function useEncerrarCompromisso() {
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ compromissoId, status }: { compromissoId: string; status: "quebrado" | "cancelado" | "cumprido" }) => {
      const { error } = await rpcCobranca("cobranca_compromisso_encerrar", {
        p_compromisso: compromissoId,
        p_status: status,
      });
      if (error) throw error;
    },
    onSettled: invalidar,
  });
}

export function useRegistrarPagamento() {
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ casoId, valor, pagoEm, tituloId }: { casoId: string; valor: number; pagoEm: string; tituloId?: string }) => {
      const { data, error } = await rpcCobranca("cobranca_pagamento_registrar", {
        p_caso: casoId,
        p_valor: valor,
        p_pago_em: pagoEm,
        p_titulo: tituloId,
      });
      if (error) throw error;
      const r = (data ?? {}) as { saldo_restante?: number | string; quitado?: boolean };
      return { saldoRestante: Number(r.saldo_restante ?? 0), quitado: r.quitado === true };
    },
    onSettled: invalidar,
  });
}

export function useRegistrarContato() {
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ casoId, canal, resultado, nota }: { casoId: string; canal: CanalDeContato; resultado: ResultadoDoContato; nota?: string }) => {
      const { error } = await rpcCobranca("cobranca_contato_registrar", {
        p_caso: casoId,
        p_canal: canal,
        p_resultado: resultado,
        p_nota: nota?.trim() || undefined,
      });
      if (error) throw error;
    },
    onSettled: invalidar,
  });
}

export function useNaoContatar() {
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ inadimplenteId, valor, motivo }: { inadimplenteId: string; valor: boolean; motivo?: string }) => {
      const { error } = await rpcCobranca("cobranca_nao_contatar", {
        p_inadimplente: inadimplenteId,
        p_valor: valor,
        p_motivo: motivo?.trim() || undefined,
      });
      if (error) throw error;
    },
    onSettled: invalidar,
  });
}

export function useArquivarInadimplente() {
  const invalidar = useInvalidarCobranca();
  return useMutation({
    mutationFn: async ({ inadimplenteId, motivo }: { inadimplenteId: string; motivo: string }) => {
      const { error } = await rpcCobranca("cobranca_inadimplente_arquivar", {
        p_inadimplente: inadimplenteId,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSettled: invalidar,
  });
}
