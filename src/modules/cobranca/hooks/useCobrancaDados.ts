import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

import { type FaixaDeAtraso, isoDia, recorteDeVencimento } from "../lib/atraso";
import { soDigitos } from "../lib/documento";
import {
  type Etapa,
  type EventoDoCaso,
  type InadimplenteResumo,
  type MetricasDaCobranca,
  type Origem,
  type TituloSaldo,
  parseEtapa,
  parseEvento,
  parseMetricas,
  parseResumo,
  parseTitulo,
} from "../lib/tipos";
import { rpcCobranca } from "../lib/rpc";

/**
 * Leitura da área de cobrança. Tudo passa pela RLS (flag + cobranca.view): a
 * view `cobranca_inadimplentes_resumo` já traz o caso aberto, a etapa, o saldo
 * e o último contato numa linha por inadimplente.
 *
 * Chave raiz `["cobranca", org]`: toda escrita invalida a raiz — a área é
 * pequena e um número velho numa tela de dinheiro custa mais que um refetch.
 */
export const CHAVE_COBRANCA = "cobranca";
export const TAMANHO_DA_PAGINA = 50;

export function useEtapas() {
  const { organizationId } = useOrganization();
  const qc = useQueryClient();
  const semeou = useRef(false);

  const query = useQuery<Etapa[]>({
    queryKey: [CHAVE_COBRANCA, organizationId, "etapas"],
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cobranca_etapas")
        .select("*")
        .eq("organization_id", organizationId as string)
        .order("posicao");
      if (error) throw error;
      return (data ?? []).map((r) => parseEtapa(r as Record<string, unknown>));
    },
  });

  // Org recém-ligada sem etapas: semeia uma vez (a RPC é idempotente).
  useEffect(() => {
    if (!organizationId || semeou.current || query.isLoading || (query.data?.length ?? 0) > 0) return;
    semeou.current = true;
    void rpcCobranca("cobranca_etapas_garantir", { p_org: organizationId }).then(({ error }) => {
      if (!error) void qc.invalidateQueries({ queryKey: [CHAVE_COBRANCA, organizationId, "etapas"] });
    });
  }, [organizationId, query.isLoading, query.data, qc]);

  return query;
}

export type SituacaoDoFiltro = "em_aberto" | "todos";

export interface FiltrosDeInadimplentes {
  busca: string;
  situacao: SituacaoDoFiltro;
  faixa: FaixaDeAtraso | null;
  etapaId: string | null;
  /** `"sem"` = sem responsável. */
  responsavel: string | null;
  origem: Origem | null;
  comCompromisso: boolean;
  /** Caso aberto sem contato registrado nos últimos 7 dias (o cartão da faixa de números). */
  semContato: boolean;
  ordem: "atraso" | "saldo" | "recentes";
  pagina: number;
}

export const FILTROS_PADRAO: FiltrosDeInadimplentes = {
  busca: "",
  situacao: "em_aberto",
  faixa: null,
  etapaId: null,
  responsavel: null,
  origem: null,
  comCompromisso: false,
  semContato: false,
  ordem: "atraso",
  pagina: 0,
};

/** Termo livre do usuário dentro de um `or()` do PostgREST: sem vírgula, parêntese nem curinga. */
function termoSeguro(t: string): string {
  return t.replace(/[,()%*\\]/g, " ").trim();
}

export function useInadimplentes(filtros: FiltrosDeInadimplentes) {
  const { organizationId } = useOrganization();
  return useQuery<{ linhas: InadimplenteResumo[]; total: number }>({
    queryKey: [CHAVE_COBRANCA, organizationId, "inadimplentes", filtros],
    enabled: !!organizationId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from("cobranca_inadimplentes_resumo")
        .select("*", { count: "exact" })
        .eq("organization_id", organizationId as string);

      if (filtros.situacao === "em_aberto") q = q.not("caso_id", "is", null);
      if (filtros.etapaId) q = q.eq("etapa_id", filtros.etapaId);
      if (filtros.responsavel === "sem") q = q.is("responsavel_id", null).not("caso_id", "is", null);
      else if (filtros.responsavel) q = q.eq("responsavel_id", filtros.responsavel);
      if (filtros.origem) q = q.eq("origem", filtros.origem);
      if (filtros.comCompromisso) q = q.not("compromisso_tipo", "is", null);
      if (filtros.semContato) {
        // Mesma régua da RPC de métricas: nunca contatado ou último contato antes de 7 dias atrás.
        const seteDias = new Date();
        seteDias.setDate(seteDias.getDate() - 7);
        q = q.not("caso_id", "is", null).or(`ultimo_contato_em.is.null,ultimo_contato_em.lt.${isoDia(seteDias)}`);
      }
      if (filtros.faixa) {
        const r = recorteDeVencimento(filtros.faixa);
        if (r.gte) q = q.gte("vencimento_mais_antigo", r.gte);
        if (r.lte) q = q.lte("vencimento_mais_antigo", r.lte);
      }

      const termo = termoSeguro(filtros.busca);
      if (termo) {
        const digitos = soDigitos(termo);
        const partes = [`nome.ilike.%${termo}%`, `email.ilike.%${termo}%`, `contato_nome.ilike.%${termo}%`];
        if (digitos.length >= 3) partes.push(`documento.ilike.%${digitos}%`, `telefone.ilike.%${digitos}%`);
        q = q.or(partes.join(","));
      }

      if (filtros.ordem === "saldo") q = q.order("saldo_aberto", { ascending: false });
      else if (filtros.ordem === "recentes") q = q.order("created_at", { ascending: false });
      else q = q.order("vencimento_mais_antigo", { ascending: true, nullsFirst: false });
      q = q.order("nome");

      const de = filtros.pagina * TAMANHO_DA_PAGINA;
      const { data, error, count } = await q.range(de, de + TAMANHO_DA_PAGINA - 1);
      if (error) throw error;
      return {
        linhas: (data ?? []).map((r) => parseResumo(r as Record<string, unknown>)),
        total: count ?? 0,
      };
    },
  });
}

/** Casos abertos, para o quadro. Um caso por inadimplente — a view já garante. */
export function useCasosAbertos() {
  const { organizationId } = useOrganization();
  return useQuery<InadimplenteResumo[]>({
    queryKey: [CHAVE_COBRANCA, organizationId, "quadro"],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cobranca_inadimplentes_resumo")
        .select("*")
        .eq("organization_id", organizationId as string)
        .not("caso_id", "is", null)
        .order("posicao")
        .limit(2000);
      if (error) throw error;
      return (data ?? []).map((r) => parseResumo(r as Record<string, unknown>));
    },
  });
}

export interface CasoEncerrado {
  casoId: string;
  inadimplenteId: string;
  nome: string;
  etapaId: string;
  desfecho: string;
  encerradoEm: string;
  valorPago: number;
}

/** Desfechos dos últimos 30 dias, para as colunas de Recuperado/Perdido/Cancelado. */
export function useCasosEncerrados() {
  const { organizationId } = useOrganization();
  return useQuery<CasoEncerrado[]>({
    queryKey: [CHAVE_COBRANCA, organizationId, "encerrados"],
    enabled: !!organizationId,
    queryFn: async () => {
      const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data: casos, error } = await supabase
        .from("cobranca_casos")
        .select("id, inadimplente_id, etapa_id, desfecho, encerrado_em")
        .eq("organization_id", organizationId as string)
        .not("encerrado_em", "is", null)
        .gte("encerrado_em", desde)
        .order("encerrado_em", { ascending: false })
        .limit(150);
      if (error) throw error;
      if (!casos?.length) return [];
      const idsInad = [...new Set(casos.map((c) => c.inadimplente_id))];
      const idsCaso = casos.map((c) => c.id);
      const [nomes, pagos] = await Promise.all([
        supabase.from("cobranca_inadimplentes").select("id, nome").in("id", idsInad),
        supabase.from("cobranca_pagamentos").select("caso_id, valor").in("caso_id", idsCaso),
      ]);
      if (nomes.error) throw nomes.error;
      if (pagos.error) throw pagos.error;
      const nomePor = new Map((nomes.data ?? []).map((n) => [n.id, n.nome]));
      const pagoPor = new Map<string, number>();
      for (const p of pagos.data ?? []) pagoPor.set(p.caso_id, (pagoPor.get(p.caso_id) ?? 0) + Number(p.valor));
      return casos.map((c) => ({
        casoId: c.id,
        inadimplenteId: c.inadimplente_id,
        nome: nomePor.get(c.inadimplente_id) ?? "—",
        etapaId: c.etapa_id,
        desfecho: c.desfecho ?? "",
        encerradoEm: c.encerrado_em ?? "",
        valorPago: pagoPor.get(c.id) ?? 0,
      }));
    },
  });
}

export function useMetricas() {
  const { organizationId } = useOrganization();
  const hoje = isoDia(new Date());
  return useQuery<MetricasDaCobranca>({
    queryKey: [CHAVE_COBRANCA, organizationId, "metricas", hoje],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await rpcCobranca("cobranca_metricas", {
        p_org: organizationId as string,
        p_hoje: hoje,
      });
      if (error) throw error;
      return parseMetricas(data);
    },
  });
}

export interface CompromissoAtivo {
  id: string;
  tipo: "promessa" | "acordo";
  observacao: string | null;
  criadoEm: string;
  parcelas: { numero: number; vencimento: string; valor: number }[];
}

export interface FichaDoInadimplente {
  resumo: InadimplenteResumo;
  observacoes: string | null;
  titulos: TituloSaldo[];
  eventos: EventoDoCaso[];
  compromisso: CompromissoAtivo | null;
}

export function useFichaDoInadimplente(inadimplenteId: string | null) {
  const { organizationId } = useOrganization();
  return useQuery<FichaDoInadimplente | null>({
    queryKey: [CHAVE_COBRANCA, organizationId, "ficha", inadimplenteId],
    enabled: !!organizationId && !!inadimplenteId,
    queryFn: async () => {
      const id = inadimplenteId as string;
      const [resumo, base, titulos, eventos] = await Promise.all([
        supabase.from("cobranca_inadimplentes_resumo").select("*").eq("id", id).maybeSingle(),
        supabase.from("cobranca_inadimplentes").select("observacoes").eq("id", id).maybeSingle(),
        supabase.from("cobranca_titulos_saldo").select("*").eq("inadimplente_id", id).order("vencimento"),
        supabase
          .from("cobranca_eventos")
          .select("*")
          .eq("inadimplente_id", id)
          .order("created_at", { ascending: false })
          .limit(60),
      ]);
      for (const r of [resumo, base, titulos, eventos]) if (r.error) throw r.error;
      if (!resumo.data) return null;
      const r = parseResumo(resumo.data as Record<string, unknown>);

      let compromisso: CompromissoAtivo | null = null;
      if (r.casoId) {
        const { data: c, error } = await supabase
          .from("cobranca_compromissos")
          .select("id, tipo, observacao, created_at")
          .eq("caso_id", r.casoId)
          .eq("status", "ativo")
          .maybeSingle();
        if (error) throw error;
        if (c) {
          const { data: parcelas, error: e2 } = await supabase
            .from("cobranca_compromisso_parcelas")
            .select("numero, vencimento, valor")
            .eq("compromisso_id", c.id)
            .order("numero");
          if (e2) throw e2;
          compromisso = {
            id: c.id,
            tipo: c.tipo as CompromissoAtivo["tipo"],
            observacao: c.observacao,
            criadoEm: c.created_at,
            parcelas: (parcelas ?? []).map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: Number(p.valor) })),
          };
        }
      }

      return {
        resumo: r,
        observacoes: (base.data?.observacoes as string | null) ?? null,
        titulos: (titulos.data ?? []).map((t) => parseTitulo(t as Record<string, unknown>)),
        eventos: (eventos.data ?? []).map((e) => parseEvento(e as Record<string, unknown>)),
        compromisso,
      };
    },
  });
}
