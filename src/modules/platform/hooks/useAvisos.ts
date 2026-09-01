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
import { mostrarCartao } from "../lib/cartoes-store";
import { usePreferenciasDeAviso } from "./usePreferenciasDeAviso";
import { usePresenca } from "./usePresenca";

/** Teto do que o sino carrega. Varrer o histórico é trabalho do Inbox (#1889). */
const TETO = 50;

/**
 * A consulta periódica deixa de ser o mecanismo e vira rede de segurança: se o
 * canal cair sem avisar, o sino se corrige em minutos em vez de nunca.
 */
const REDE_DE_SEGURANCA_MS = 5 * 60_000;

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

export function useAvisos(): UseAvisosResult {
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

  useEffect(() => motorDeSom.destravarNoPrimeiroGesto(), []);

  // O sino vive no cabeçalho de toda tela autenticada: é o lugar natural para
  // carimbar "tem alguém olhando".
  usePresenca();

  const queryKey = useMemo(() => ["avisos", organizationId, user?.id], [organizationId, user?.id]);
  const habilitado = isReady && !!organizationId && !!user?.id;

  const { data: avisos = [], isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<Aviso[]> => {
      if (!organizationId || !user?.id) return [];

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
      // types.ts é gerado a partir de PROD e ainda não conhece group_key,
      // event_count e last_event_at — as colunas nascem na migration desta
      // entrega. Regenerar depois do deploy remove esta conversão.
      return (data ?? []) as unknown as Aviso[];
    },
    enabled: habilitado,
    refetchInterval: REDE_DE_SEGURANCA_MS,
  });

  useRealtimeChannel({
    table: "notifications",
    filter: user?.id ? `user_id=eq.${user.id}` : undefined,
    enabled: habilitado,
    statusKey: "avisos",
    onEvent: (payload) => {
      if (!organizationId) return;

      const evento = paraEvento(payload);
      if (!evento) return;

      queryClient.setQueryData<Aviso[]>(queryKey, (atual = []) =>
        aplicarEventoDeAviso(atual, evento, organizationId),
      );

      if (evento.tipo === "DELETE") return;
      if (evento.aviso.organization_id !== organizationId) return;
      // Aviso que já nasceu lido (o próprio usuário agindo noutra aba) não toca.
      if (evento.aviso.read_at !== null) return;

      const agora = Date.now();
      const abaVisivel = typeof document === "undefined" || document.visibilityState === "visible";
      const decisao: Entrega = decidirEntrega(evento.aviso, evento.tipo, {
        preferencias: preferenciasRef.current,
        abaVisivel,
        conversaAbertaLeadId: conversaAberta(),
        ultimoSomPorChave: ultimoSomPorChave.current,
        horaLocal: horaLocalDeSaoPaulo(agora),
        agora,
      });

      if (decisao.som) {
        motorDeSom.tocar(decisao.som, preferenciasRef.current.volume);
        if (evento.aviso.group_key) {
          ultimoSomPorChave.current[evento.aviso.group_key] = agora;
        }
      }

      if (decisao.cartao) {
        mostrarCartao(evento.aviso, agora, abaVisivel);
      }
    },
  });

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
