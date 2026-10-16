/**
 * A leitura do sino: Avisos vindos do banco, em tempo real, da organização
 * aberta na tela.
 *
 * Antes daqui, o sino montava a lista com quatro consultas feitas no navegador
 * a cada 60 segundos e guardava "o que já vi" no localStorage (teto de 200 ids,
 * perdido ao trocar de máquina). Nada disso sobrevive: o Aviso é linha, o lido
 * é estado da linha, e o que chega vem por assinatura em vez de varredura.
 *
 * O canal é endereçado ao próprio usuário — a política de RLS já corta o que
 * não é dele, e o filtro evita tráfego que seria descartado do outro lado.
 *
 * Vocabulário: CONTEXT.md, seção "Avisos". Modelo: ADR-0035.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, useOrganization } from "@/modules/identity";
import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";

import {
  aplicarEventoDeAviso,
  contarNaoLidos,
  type Aviso,
  type EventoDeAviso,
} from "../lib/aviso-stream";
import { conversaAberta } from "../lib/conversa-aberta";
import { decidirEntrega, type Entrega } from "../lib/decisao-de-entrega";
import { motorDeSom } from "../lib/motor-de-som";
import { mostrarCartao, reiniciarCartoes } from "../lib/cartoes-store";
import { intervaloDaRedeDeSeguranca } from "../lib/rede-de-seguranca-de-avisos";
import { usePreferenciasDeAviso } from "./usePreferenciasDeAviso";
import { usePresenca } from "./usePresenca";

/** Teto do que o sino carrega. Varrer o histórico é trabalho do Inbox (#1889). */
const TETO = 50;

const LISTA_VAZIA: Aviso[] = [];

export interface UseAvisosResult {
  avisos: Aviso[];
  naoLidos: number;
  carregando: boolean;
  marcarComoLido: (id: string) => Promise<void>;
  marcarTodosComoLidos: () => Promise<void>;
}

/** Hora local de quem recebe — o horário silencioso é do relógio dele, não do UTC. */
function horaLocalDeSaoPaulo(instante: number): number {
  return Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(instante)),
  );
}

// Só PilhaDeCartoes é receptor. Os sinos desktop/mobile compartilham a consulta.
export function useAvisos({ entregar = false } = {}): UseAvisosResult {
  const { user } = useAuth();
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const { preferencias } = usePreferenciasDeAviso();

  /**
   * Último som por chave de agrupamento. Vive num ref, não em estado: mudar
   * isto não pode repintar o sino, e ele não sobrevive ao recarregar de
   * propósito — quem acabou de abrir a aba merece ser avisado.
   */
  const ultimoSomPorChave = useRef<Record<string, number>>({});
  const preferenciasRef = useRef(preferencias);
  preferenciasRef.current = preferencias;

  useEffect(() => {
    if (entregar) return motorDeSom.destravarNoPrimeiroGesto();
  }, [entregar]);

  // Só o receptor global registra presença; montar outro sino não cria timer.
  usePresenca(entregar);

  const queryKey = useMemo(() => ["avisos", organizationId, user?.id], [organizationId, user?.id]);
  const habilitado = isReady && !!organizationId && !!user?.id;
  const recebidos = useMemo(() => ({ organizationId, userId: user?.id, versoes: new Map<string, string>(), inicializado: false }),
    [organizationId, user?.id]);

  useEffect(() => {
    if (!entregar) return;
    ultimoSomPorChave.current = {};
    reiniciarCartoes();
    return reiniciarCartoes;
  }, [entregar, organizationId, user?.id]);

  const receber = useCallback((aviso: Aviso, anunciar: boolean) => {
    if (!entregar || !habilitado || aviso.organization_id !== recebidos.organizationId || aviso.user_id !== recebidos.userId) return;
    const versao = `${aviso.event_count}:${aviso.last_event_at ?? aviso.created_at}`;
    const anterior = recebidos.versoes.get(aviso.id);
    recebidos.versoes.set(aviso.id, versao);
    if (recebidos.versoes.size > 500) recebidos.versoes.delete(recebidos.versoes.keys().next().value!);
    if (!anunciar || anterior === versao || aviso.read_at !== null) return;

    const agora = Date.now();
    const abaVisivel = document.visibilityState === "visible";
    const decisao: Entrega = decidirEntrega(aviso, anterior ? "UPDATE" : "INSERT", {
      preferencias: preferenciasRef.current, abaVisivel,
      conversaAbertaLeadId: conversaAberta(), ultimoSomPorChave: ultimoSomPorChave.current,
      horaLocal: horaLocalDeSaoPaulo(agora), agora,
    });
    if (decisao.som) {
      void motorDeSom.tocar(decisao.som, preferenciasRef.current.volume);
      if (aviso.group_key) ultimoSomPorChave.current[aviso.group_key] = agora;
    }
    if (decisao.cartao) mostrarCartao(aviso, agora, abaVisivel);
  }, [entregar, habilitado, recebidos]);

  /**
   * O canal precisa de uma releitura quando chegar a `joined`? Sim sempre que
   * ele esteve fora de pé — inclusive na ENTRADA: consulta e canal sobem juntos
   * na montagem, e o que foi gravado entre a fotografia da consulta e o
   * primeiro `joined` não vem pelo canal. Sem esta releitura, uma aba sempre em
   * foco (TV, desktop) só recuperaria esse aviso na sonda de 5 min. Idem para
   * o buraco entre a última consulta de 30 s e o religar depois de uma queda.
   *
   * Só não relê quando a instância ENTRA num canal já `joined` (aberto por
   * outra instância): não houve janela sem canal.
   */
  const precisaReler = useRef(true);

  /**
   * A releitura tem que ser de uma fotografia tirada DEPOIS do join. Não basta
   * `invalidateQueries`: com a 1ª consulta ainda em voo e o cache vazio, o
   * TanStack (v5.83, `Query.fetch`) reaproveita a promessa em voo em vez de
   * cancelá-la — e a fotografia dela é anterior ao aviso gravado na janela.
   * Cancelar também não serve: a consulta cancelada sem dado volta a pending e
   * a releitura vira a PRIMEIRA fotografia, que é tratada como histórico (sem
   * som). Então: cada consulta recebe um número de ordem ao começar, o join
   * recebe o seu, e a releitura só se dá por feita quando chega uma fotografia
   * de número maior. Se há consulta em voo, espera ela terminar (vira o
   * histórico) e só então relê. Relógio lógico, não `Date.now()`: consulta e
   * join no mesmo milissegundo continuam ordenados.
   */
  const ordem = useRef(0);
  const ordemDaFotografia = useRef(0);
  const releituraDesde = useRef<number | null>(null);

  const conferirReleitura = useCallback(() => {
    const desde = releituraDesde.current;
    if (desde === null) return;
    if (ordemDaFotografia.current > desde) {
      releituraDesde.current = null;
      return;
    }
    // Consulta em voo: o sucesso dela chama de novo (efeito de `dataUpdatedAt`).
    if (queryClient.getQueryState(queryKey)?.fetchStatus === "fetching") return;
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }, [queryClient, queryKey]);

  // O canal vem ANTES da consulta: é o estado dele que decide se a consulta
  // periódica precisa existir (`intervaloDaRedeDeSeguranca`).
  const { state: estadoDoCanal } = useRealtimeChannel({
    table: "notifications",
    filter: user?.id ? `user_id=eq.${user.id}` : undefined,
    enabled: habilitado && entregar,
    statusKey: "avisos",
    onStateChange: ({ state, initial }) => {
      if (state !== "joined") {
        precisaReler.current = true;
        return;
      }
      const reler = precisaReler.current && !initial;
      precisaReler.current = false;
      if (!reler) return;
      releituraDesde.current = ++ordem.current;
      conferirReleitura();
    },
    onEvent: (payload) => {
      if (!organizationId) return;

      const evento = paraEvento(payload);
      if (!evento) return;
      if (evento.tipo !== "DELETE" && (evento.aviso.organization_id !== organizationId || evento.aviso.user_id !== user?.id)) return;

      queryClient.setQueryData<Aviso[]>(queryKey, (atual = []) =>
        aplicarEventoDeAviso(atual, evento, organizationId).slice(0, TETO),
      );

      if (evento.tipo !== "DELETE") receber(evento.aviso, true);
    },
  });

  const { data: avisos = LISTA_VAZIA, isLoading, isSuccess, dataUpdatedAt } = useQuery({
    queryKey,
    queryFn: async (): Promise<Aviso[]> => {
      if (!organizationId || !user?.id) return [];
      const ordemDestaConsulta = ++ordem.current;

      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id, organization_id, user_id, type, title, description, link, lead_id, entity_id, group_key, event_count, last_event_at, created_at, read_at",
        )
        .eq("user_id", user.id)
        // A organização é filtro de entrada: quem participa de duas não pode ver,
        // na org aberta, Aviso nascido na outra.
        .eq("organization_id", organizationId)
        .order("last_event_at", { ascending: false, nullsFirst: false })
        .limit(TETO);

      if (error) throw error;
      ordemDaFotografia.current = Math.max(ordemDaFotografia.current, ordemDestaConsulta);
      // types.ts é gerado a partir de PROD e ainda não conhece group_key,
      // event_count e last_event_at — as colunas nascem na migration desta
      // entrega. Regenerar depois do deploy remove esta conversão.
      return (data ?? []) as unknown as Aviso[];
    },
    enabled: habilitado,
    // Canal saudável → sonda de 5 min; degradado → 30 s. Aba escondida nunca
    // consulta. Ao voltar à aba, o receptor relê sempre (ignora o staleTime
    // global de 5 min): é por ali que volta o que o canal perdeu enquanto a
    // aba dormia, e a mesma deduplicação de `receber` impede som repetido.
    refetchInterval: intervaloDaRedeDeSeguranca(entregar, estadoDoCanal),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: entregar ? "always" : false,
  });

  useEffect(() => {
    if (!entregar || !isSuccess) return;
    // A primeira fotografia é histórico. Depois disso, polling e realtime
    // passam pela mesma deduplicação: recuperar conexão não pode deixar mudo.
    for (const aviso of avisos) receber(aviso, recebidos.inicializado);
    recebidos.inicializado = true;
  }, [avisos, entregar, isSuccess, receber, recebidos]);

  // Cada fotografia nova pode encerrar (ou destravar) uma releitura pendente.
  // Só sucesso conta: erro não muda `dataUpdatedAt`, então falha persistente
  // não vira laço de releitura — a sonda/foco seguintes resolvem.
  useEffect(() => {
    if (dataUpdatedAt) conferirReleitura();
  }, [dataUpdatedAt, conferirReleitura]);

  const marcarComoLido = useCallback(
    async (id: string) => {
      const agora = new Date().toISOString();
      queryClient.setQueryData<Aviso[]>(queryKey, (atual = []) =>
        atual.map((a) => (a.id === id ? { ...a, read_at: agora } : a)),
      );
      await supabase.from("notifications").update({ read_at: agora }).eq("id", id);
    },
    [queryClient, queryKey],
  );

  const marcarTodosComoLidos = useCallback(async () => {
    if (!user?.id || !organizationId) return;
    const agora = new Date().toISOString();

    queryClient.setQueryData<Aviso[]>(queryKey, (atual = []) =>
      atual.map((a) => (a.read_at ? a : { ...a, read_at: agora })),
    );

    await supabase
      .from("notifications")
      .update({ read_at: agora })
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .is("read_at", null);
  }, [organizationId, queryClient, queryKey, user?.id]);

  return {
    avisos,
    naoLidos: contarNaoLidos(avisos),
    carregando: isLoading,
    marcarComoLido,
    marcarTodosComoLidos,
  };
}

function paraEvento(payload: {
  eventType?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}): EventoDeAviso | null {
  if (payload.eventType === "INSERT" && payload.new) {
    return { tipo: "INSERT", aviso: payload.new as unknown as Aviso };
  }
  if (payload.eventType === "UPDATE" && payload.new) {
    return { tipo: "UPDATE", aviso: payload.new as unknown as Aviso };
  }
  if (payload.eventType === "DELETE" && payload.old?.id) {
    return { tipo: "DELETE", aviso: { id: String(payload.old.id) } };
  }
  return null;
}
