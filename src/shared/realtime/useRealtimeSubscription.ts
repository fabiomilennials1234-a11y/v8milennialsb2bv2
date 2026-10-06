import { useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeOrgId } from "./realtime-org-context";
import { useRealtimeChannel } from "./useRealtimeChannel";
import {
  isRealtimeTabHidden,
  lastRealtimeDelivery,
  nextRealtimeSeq,
  normalizeTarget,
  recordRealtimeDelivery,
  requestInvalidation,
  retainInvalidationScheduler,
  type InvalidationTarget,
  type NormalizedTarget,
  type WhenHidden,
} from "./invalidation-scheduler";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export type { InvalidationTarget, WhenHidden } from "./invalidation-scheduler";

/**
 * Debounce de 2 segundos para evitar cascade de invalidações
 * quando múltiplas mudanças chegam em sequência (ex: bulk update de leads)
 */
const DEBOUNCE_MS = 2000;

/**
 * Atraso dos alvos depois do primeiro (`targets[1..]`). Fixo em 2 s, como
 * sempre foi — `useSocialRealtime` documenta e depende disso (lista primeiro,
 * thread depois).
 */
const STAGGER_MS = 2000;

/**
 * Tabelas que NÃO têm coluna organization_id — usam wildcard.
 * Todas as outras são filtradas por org_id para reduzir ~80% do tráfego realtime.
 */
const TABLES_WITHOUT_ORG_ID = new Set([
  "team_members",
  "user_roles",
  "profiles",
  "master_users",
  "tags",
  "checklist_items",
  // blast_plan_recipients carries no organization_id (tenancy via plan_id →
  // blast_plans); subscribe without the org filter (#910 live blast feed).
  "blast_plan_recipients",
  // Tabelas na publication supabase_realtime que NÃO têm coluna
  // organization_id — filtrar por ela gera "invalid column for filter
  // organization_id" e derruba o canal (degrada o pool de Realtime).
  // A RLS (apply_rls) já gate os eventos por org; a invalidação por queryKey
  // re-busca com escopo no servidor. (schema drift fix 2026-07-17)
  "acoes_do_dia",
  "campanha_leads",
  "feature_permissions",
  "lead_scores",
  "pipe_proposta_items",
  "support_ticket_comments",
  "upsell_client_products",
]);

export interface RealtimeHandlers<T = any> {
  /**
   * Called on UPDATE events. Receives the updated record (flat, no joins)
   * and the current cached data. Return the new cache value.
   * When provided, avoids full invalidation for updates.
   * Aplicado ao prefixo do PRIMEIRO alvo.
   */
  onUpdate?: (updatedRecord: T, oldData: T[]) => T[];
  /**
   * Called on DELETE events. Receives the old record and current cached data.
   * Return the new cache value.
   * Aplicado ao prefixo do PRIMEIRO alvo.
   */
  onDelete?: (deletedRecord: T, oldData: T[]) => T[];
}

/**
 * O que fazer com um evento, decidido por quem conhece a tela:
 *   - `"skip"`: nada a invalidar (o chamador pode ter feito patch no cache);
 *   - `"invalidate"`: todos os alvos, como um evento comum;
 *   - `{ invalidate: [...] }`: só estes alvos (comparados por chave).
 */
export type RealtimeEventDecision =
  | "skip"
  | "invalidate"
  | { readonly invalidate: readonly InvalidationTarget[] };

export interface RealtimeSubscriptionOptions<T> extends RealtimeHandlers<T> {
  /** Classificador do evento. Quando presente, `onUpdate`/`onDelete` são ignorados. */
  onEvent?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => RealtimeEventDecision;
  /** `false` não abre canal. Padrão: `true`. */
  enabled?: boolean;
  /** Silêncio exigido antes de disparar (debounce). Padrão: 2 000 ms. */
  quietMs?: number;
  /** Teto da espera sob rajada contínua. Padrão: sem teto (debounce puro). OPT-IN. */
  maxWaitMs?: number;
  /** Aba oculta: `"flush"` refaz como sempre (padrão); `"defer"` guarda até voltar. OPT-IN. */
  whenHidden?: WhenHidden;
  /**
   * Recupera o que o canal DESTA instância perdeu enquanto entrava. OPT-IN —
   * desligado, nada muda. Cada instância tem o próprio canal, com join
   * independente; evento entregue antes do SUBSCRIBED dela não chega a ela.
   *   - 1º SUBSCRIBED do canal (montagem, troca de org, religar): se outra
   *     instância recebeu evento desta tabela + filtro depois que este canal
   *     começou a entrar, agenda todos os alvos como um evento comum — e o
   *     agendador só refaz query cujo retrato é mais velho que essa entrega.
   *     Ninguém recebeu nada: 0 consulta;
   *   - SUBSCRIBED de novo depois de cair (erro, timeout, circuito aberto):
   *     agenda todos os alvos uma vez, sempre — o que chegou durante a queda
   *     pode ter caído para todas as instâncias.
   * O prazo é o de um evento (`quietMs`, `maxWaitMs`, stagger, `minAgeMs`,
   * `whenHidden`); fetch em voo é esperado, nunca cancelado.
   */
  catchUpOnSubscribe?: boolean;
}

/**
 * Onde o canal desta instância está, visto daqui. `joining` = ainda não houve
 * SUBSCRIBED desde que o canal (tabela + filtro) nasceu; `lost` = caiu depois
 * de ter entrado.
 */
interface SubscribeLink {
  channelKey: string | null;
  /** Sequência tirada quando o canal começou a entrar. */
  since: number;
  phase: "joining" | "live" | "lost";
}

interface PendingState {
  /** Índices de alvo pedidos desde o último disparo. */
  indexes: Set<number>;
  targets: NormalizedTarget[];
  seq: number;
  firstAt: number | null;
  debounce: ReturnType<typeof setTimeout> | null;
  stagger: ReturnType<typeof setTimeout> | null;
  staggerTargets: Map<string, NormalizedTarget>;
  staggerSeq: number;
}

/**
 * Invalida queries quando a tabela muda no Postgres (realtime), com o filtro de
 * org no servidor.
 *
 * `targets` — cada item é UM alvo de invalidação (prefixo de queryKey):
 *   - `["leads", "pipeline"]` → dois alvos, `["leads"]` e `["pipeline"]` (legado);
 *   - `[["pipeline_entries", slug, org]]` → um alvo composto;
 *   - `[{ queryKey, minAgeMs }]` → alvo com idade mínima (opt-in).
 *
 * Composto PLANO (`["pipeline_entries", slug, org]`) não é composto: vira três
 * alvos de um segmento — o primeiro invalida o domínio inteiro e os outros não
 * casam com nada. A regra `no-restricted-syntax` do `eslint.config.js` barra.
 *
 * Tempo (sem opt-in, igual a sempre): o primeiro alvo dispara 2 s depois do
 * último evento; os demais, 2 s depois do primeiro. O SE de cada disparo é do
 * `invalidation-scheduler` (coalescência entre instâncias, fetch em voo: o
 * disparo que encontra o alvo buscando espera o fim desse fetch, não um novo
 * `quietMs`).
 */
export function useRealtimeSubscription<T = any>(
  table: string,
  targets: readonly InvalidationTarget[],
  options?: RealtimeSubscriptionOptions<T>
) {
  const queryClient = useQueryClient();
  const organizationId = useRealtimeOrgId();
  // Layout effect: roda antes dos effects passivos, onde as queries da mesma
  // tela disparam o fetch inicial — que assim já entra no frescor.
  useLayoutEffect(() => retainInvalidationScheduler(queryClient), [queryClient]);

  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pendingRef = useRef<PendingState>({
    indexes: new Set(),
    targets: [],
    seq: 0,
    firstAt: null,
    debounce: null,
    stagger: null,
    staggerTargets: new Map(),
    staggerSeq: 0,
  });

  const flush = useCallback(() => {
    const st = pendingRef.current;
    const opts = optionsRef.current;
    const indexes = st.indexes;
    const normalized = st.targets;
    const seq = st.seq;
    st.indexes = new Set();
    st.firstAt = null;
    if (st.debounce) clearTimeout(st.debounce);
    st.debounce = null;

    const request = { eventSeq: seq, whenHidden: opts?.whenHidden ?? "flush" } as const;

    if (indexes.has(0) && normalized[0]) {
      requestInvalidation(queryClient, normalized[0], request);
    }

    const followers = [...indexes].filter((i) => i > 0 && normalized[i]);
    if (followers.length === 0) return;
    // Como sempre: um disparo novo substitui o stagger pendente — sem perder
    // os alvos que ele levaria.
    if (st.stagger) clearTimeout(st.stagger);
    for (const i of followers) st.staggerTargets.set(normalized[i].hash, normalized[i]);
    st.staggerSeq = Math.max(st.staggerSeq, seq);
    st.stagger = setTimeout(() => {
      const due = [...st.staggerTargets.values()];
      const dueSeq = st.staggerSeq;
      st.staggerTargets = new Map();
      st.staggerSeq = 0;
      st.stagger = null;
      for (const target of due) {
        requestInvalidation(queryClient, target, { ...request, eventSeq: dueSeq });
      }
    }, STAGGER_MS);
  }, [queryClient]);

  /** Agenda os alvos `requested` como um evento de sequência `seq`. */
  const enqueue = useCallback(
    (requested: readonly number[], normalized: NormalizedTarget[], seq: number) => {
      const opts = optionsRef.current;
      const st = pendingRef.current;
      for (const i of requested) st.indexes.add(i);
      st.targets = normalized;
      st.seq = Math.max(st.seq, seq);
      const now = Date.now();
      if (st.firstAt === null) st.firstAt = now;
      if (st.debounce) clearTimeout(st.debounce);

      // Aba oculta com "defer": esperar o silêncio não serve a ninguém — o
      // agendador guarda o pedido até a aba voltar, e aí dispara já.
      if (opts?.whenHidden === "defer" && isRealtimeTabHidden()) {
        flush();
        return;
      }

      const quiet = opts?.quietMs ?? DEBOUNCE_MS;
      const delay =
        opts?.maxWaitMs === undefined
          ? quiet
          : Math.max(0, Math.min(quiet, st.firstAt + opts.maxWaitMs - now));
      st.debounce = setTimeout(flush, delay);
    },
    [flush]
  );

  const channelKeyRef = useRef("");

  const handleRealtimeEvent = useCallback(
    (payload: RealtimePostgresChangesPayload<any>) => {
      recordRealtimeDelivery(queryClient, channelKeyRef.current);
      // Item nulo (chave montada antes da org existir, chamador JS) é ignorado —
      // nunca vira chave vazia, que casaria com o cache inteiro.
      const normalized = targetsRef.current.filter((t) => t != null).map(normalizeTarget);
      if (normalized.length === 0) return;
      const opts = optionsRef.current;
      const eventType = payload.eventType;

      let requested: number[];
      if (opts?.onEvent) {
        const decision = opts.onEvent(payload);
        if (decision === "skip") return;
        if (decision === "invalidate") {
          requested = normalized.map((_, i) => i);
        } else {
          const wanted = new Set(decision.invalidate.map((t) => normalizeTarget(t).hash));
          requested = normalized.flatMap((t, i) => (wanted.has(t.hash) ? [i] : []));
          if (requested.length === 0) return;
        }
      } else {
        // Surgical update: UPDATE with handler
        if (eventType === "UPDATE" && opts?.onUpdate) {
          const onUpdate = opts.onUpdate;
          queryClient.setQueriesData({ queryKey: normalized[0].queryKey }, (oldData: any) => {
            if (!Array.isArray(oldData)) return oldData;
            return onUpdate(payload.new as T, oldData);
          });
          return;
        }

        // Surgical delete: DELETE with handler
        if (eventType === "DELETE" && opts?.onDelete) {
          const onDelete = opts.onDelete;
          queryClient.setQueriesData({ queryKey: normalized[0].queryKey }, (oldData: any) => {
            if (!Array.isArray(oldData)) return oldData;
            return onDelete(payload.old as T, oldData);
          });
          return;
        }
        requested = normalized.map((_, i) => i);
      }

      // Fallback: debounced invalidation (INSERT or no handler provided)
      enqueue(requested, normalized, nextRealtimeSeq());
    },
    [queryClient, enqueue]
  );

  // Compute filter — org-based for most tables, none for TABLES_WITHOUT_ORG_ID
  const canFilter = !TABLES_WITHOUT_ORG_ID.has(table) && !!organizationId;
  const filter = canFilter ? `organization_id=eq.${organizationId}` : undefined;
  const enabled = options?.enabled ?? true;
  const channelKey = `${table}|${filter ?? "*"}`;
  channelKeyRef.current = channelKey;

  const channelState = useRealtimeChannel({
    table,
    filter,
    onEvent: handleRealtimeEvent,
    enabled,
  })?.state;

  // Recuperação no SUBSCRIBED (opt-in). O estado vem do próprio transporte:
  // `joined` só depois do SUBSCRIBED; `errored`/`polling`/`joining` depois de
  // cair. Este effect vem depois do de `useRealtimeChannel`, no mesmo commit:
  // quando o canal nasce, o `since` é tirado já com ele aberto.
  const catchUpKey = options?.catchUpOnSubscribe && enabled ? channelKey : null;
  const linkRef = useRef<SubscribeLink>({ channelKey: null, since: 0, phase: "joining" });
  useEffect(() => {
    const link = linkRef.current;
    if (catchUpKey === null) {
      link.channelKey = null;
      return;
    }
    if (link.channelKey !== catchUpKey) {
      // Canal novo: o estado lido neste render ainda é o do canal anterior.
      linkRef.current = { channelKey: catchUpKey, since: nextRealtimeSeq(), phase: "joining" };
      return;
    }
    if (channelState !== "joined") {
      if (link.phase === "live") link.phase = "lost";
      return;
    }
    if (link.phase === "live") return;
    const rejoined = link.phase === "lost";
    link.phase = "live";
    const seq = rejoined ? nextRealtimeSeq() : lastRealtimeDelivery(queryClient, catchUpKey);
    if (!rejoined && seq <= link.since) return;
    const normalized = targetsRef.current.filter((t) => t != null).map(normalizeTarget);
    if (normalized.length === 0) return;
    enqueue(normalized.map((_, i) => i), normalized, seq);
  }, [catchUpKey, channelState, queryClient, enqueue]);
}
