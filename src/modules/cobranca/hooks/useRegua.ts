import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useOrganization } from "@/modules/identity";

import { rpcCobranca } from "../lib/rpc";
import {
  type ConfiguracaoDaRegua,
  type EnvioDaRegua,
  type Gatilho,
  type Janela,
  type PassoDaRegua,
  type PreviaDaRegua,
  parseConfiguracao,
  parseEnvio,
  parsePasso,
  parsePrevia,
} from "../lib/regua";
import { CHAVE_COBRANCA } from "./useCobrancaDados";

/**
 * A régua de cobrança (entrega 2) na tela: configuração, passos, número da
 * cobrança, prévia e envios recentes. Leitura por RLS; escrita só por RPC.
 * Mesma chave raiz `["cobranca", org]` — invalidar a raiz atualiza tudo.
 */

export interface NumeroDaOrg {
  id: string;
  nome: string;
  telefone: string | null;
  provider: string;
  conectado: boolean;
  reservadoPara: string | null;
  temDono: boolean;
  temCopilot: boolean;
}

export interface DadosDaRegua {
  configuracao: ConfiguracaoDaRegua | null;
  passos: PassoDaRegua[];
  numeros: NumeroDaOrg[];
  /** Nome da organização: é o que entra em {empresa}. */
  empresa: string | null;
}

export function useRegua() {
  const { organizationId } = useOrganization();
  const qc = useQueryClient();
  const semeou = useRef(false);

  const query = useQuery<DadosDaRegua>({
    queryKey: [CHAVE_COBRANCA, organizationId, "regua"],
    enabled: !!organizationId,
    queryFn: async () => {
      const org = organizationId as string;
      const [cfg, passos, numeros, org_] = await Promise.all([
        supabase.from("cobranca_regua").select("*").eq("organization_id", org).maybeSingle(),
        supabase.from("cobranca_regua_passos").select("*").eq("organization_id", org).order("gatilho").order("dias"),
        supabase
          .from("whatsapp_instances")
          .select("id, instance_name, phone_number, provider, status, reserved_for, owner_team_member_id, copilot_agent_id")
          .eq("organization_id", org)
          .order("created_at"),
        supabase.from("organizations").select("name").eq("id", org).maybeSingle(),
      ]);
      if (cfg.error) throw cfg.error;
      if (passos.error) throw passos.error;
      if (numeros.error) throw numeros.error;
      return {
        configuracao: cfg.data ? parseConfiguracao(cfg.data as Record<string, unknown>) : null,
        passos: (passos.data ?? []).map((r) => parsePasso(r as Record<string, unknown>)),
        numeros: (numeros.data ?? []).map((r) => ({
          id: r.id,
          nome: r.instance_name ?? "Sem nome",
          telefone: r.phone_number ?? null,
          provider: r.provider ?? "",
          conectado: r.status === "connected" || r.status === "open",
          reservadoPara: r.reserved_for ?? null,
          temDono: !!r.owner_team_member_id,
          temCopilot: !!r.copilot_agent_id,
        })),
        empresa: org_.data?.name ?? null,
      };
    },
  });

  // Org com a área e sem régua ainda: semeia uma vez (RPC idempotente).
  useEffect(() => {
    if (!organizationId || semeou.current || query.isLoading || !query.data || query.data.configuracao) return;
    semeou.current = true;
    void rpcCobranca("cobranca_regua_garantir", { p_org: organizationId }).then(({ error }) => {
      if (!error) void qc.invalidateQueries({ queryKey: [CHAVE_COBRANCA, organizationId, "regua"] });
    });
  }, [organizationId, query.isLoading, query.data, qc]);

  return query;
}

export function usePreviaDaRegua() {
  const { organizationId } = useOrganization();
  return useQuery<PreviaDaRegua>({
    queryKey: [CHAVE_COBRANCA, organizationId, "regua", "previa"],
    enabled: !!organizationId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await rpcCobranca("cobranca_regua_previa", { p_org: organizationId as string });
      if (error) throw error;
      return parsePrevia(data);
    },
  });
}

export interface EnvioComNome extends EnvioDaRegua {
  nome: string;
}

export function useEnviosDaRegua(limite = 40) {
  const { organizationId } = useOrganization();
  return useQuery<EnvioComNome[]>({
    queryKey: [CHAVE_COBRANCA, organizationId, "regua", "envios", limite],
    enabled: !!organizationId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cobranca_regua_envios")
        .select("*, cobranca_inadimplentes(nome)")
        .eq("organization_id", organizationId as string)
        .neq("status", "pulado")
        .order("updated_at", { ascending: false })
        .limit(limite);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const linha = r as Record<string, unknown> & { cobranca_inadimplentes?: { nome?: string } | null };
        return { ...parseEnvio(linha), nome: linha.cobranca_inadimplentes?.nome ?? "—" };
      });
    },
  });
}

/** Envios da régua de UM caso, para a ficha. */
export function useEnviosDoCaso(casoId: string | null) {
  const { organizationId } = useOrganization();
  return useQuery<EnvioDaRegua[]>({
    queryKey: [CHAVE_COBRANCA, organizationId, "regua", "caso", casoId],
    enabled: !!organizationId && !!casoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cobranca_regua_envios")
        .select("*")
        .eq("caso_id", casoId as string)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []).map((r) => parseEnvio(r as Record<string, unknown>));
    },
  });
}

// ── Escrita ────────────────────────────────────────────────────────────────

function useInvalidar() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  return () => qc.invalidateQueries({ queryKey: [CHAVE_COBRANCA, organizationId] });
}

export interface ConfiguracaoEditavel {
  janela?: Janela;
  tetoDiario?: number;
  intervaloMinSegundos?: number;
  intervaloMaxSegundos?: number;
  pausaAposRespostaDias?: number;
  intervaloMinimoDias?: number;
  comoPagar?: string | null;
  etapaAposQuebraId?: string | null;
}

export function useSalvarRegua() {
  const { organizationId } = useOrganization();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (c: ConfiguracaoEditavel) => {
      const dados: Record<string, unknown> = {};
      if (c.janela !== undefined) dados.janela = c.janela;
      if (c.tetoDiario !== undefined) dados.teto_diario = c.tetoDiario;
      if (c.intervaloMinSegundos !== undefined) dados.intervalo_min_segundos = c.intervaloMinSegundos;
      if (c.intervaloMaxSegundos !== undefined) dados.intervalo_max_segundos = c.intervaloMaxSegundos;
      if (c.pausaAposRespostaDias !== undefined) dados.pausa_apos_resposta_dias = c.pausaAposRespostaDias;
      if (c.intervaloMinimoDias !== undefined) dados.intervalo_minimo_dias = c.intervaloMinimoDias;
      if (c.comoPagar !== undefined) dados.como_pagar = c.comoPagar ?? "";
      if (c.etapaAposQuebraId !== undefined) dados.etapa_apos_quebra_id = c.etapaAposQuebraId ?? "";
      const { error } = await rpcCobranca("cobranca_regua_salvar", { p_org: organizationId as string, p_dados: dados as Json });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useAtivarRegua() {
  const { organizationId } = useOrganization();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (ativa: boolean) => {
      const { error } = await rpcCobranca("cobranca_regua_ativar", { p_org: organizationId as string, p_ativa: ativa });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useDefinirNumero() {
  const { organizationId } = useOrganization();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (instanciaId: string | null) => {
      const { error } = await rpcCobranca("cobranca_regua_definir_numero", {
        p_org: organizationId as string,
        p_instancia: instanciaId,
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export interface PassoEditavel {
  id: string | null;
  gatilho: Gatilho;
  dias: number;
  mensagem: string | null;
  moverParaEtapaId: string | null;
  ativo: boolean;
}

export function useSalvarPasso() {
  const { organizationId } = useOrganization();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (p: PassoEditavel) => {
      const { data, error } = await rpcCobranca("cobranca_regua_passo_salvar", {
        p_org: organizationId as string,
        p_id: p.id,
        p_dados: {
          gatilho: p.gatilho,
          dias: p.dias,
          mensagem: p.mensagem?.trim() || null,
          mover_para_etapa_id: p.moverParaEtapaId,
          ativo: p.ativo,
        } as Json,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidar,
  });
}

export function useRemoverPasso() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpcCobranca("cobranca_regua_passo_remover", { p_id: id });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useCancelarEnvio() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpcCobranca("cobranca_regua_cancelar_envio", { p_envio: id });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}
