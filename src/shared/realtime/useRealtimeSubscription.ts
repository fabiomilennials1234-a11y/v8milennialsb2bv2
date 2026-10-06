import { useRef, useCallback, useLayoutEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeOrgId } from "./realtime-org-context";
import { useRealtimeChannel, type ChannelStateChange } from "./useRealtimeChannel";
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
   * Recupera o que esta instância perdeu por o canal não estar vivo. OPT-IN —
   * desligado, nada muda. O canal é COMPARTILHADO por tabela + filtro
   * (`realtimeChannelRegistry`); o que conta é como ESTA instância o encontra
   * ao entrar (montagem, troca de org, religar) e o que acontece depois:
   *   - entra com ele `joined` (outra instância já o abriu): recebe tudo
   *     daqui em diante — 0 consulta;
   *   - entra com ele no 1º join (`joining`, sem falha) e o join dá certo: no
   *     SUBSCRIBED, se OUTRO canal físico da mesma tabela + filtro recebeu
   *     evento no vão, agenda todos os alvos como um evento comum (o agendador
   *     só refaz query cujo retrato é mais velho que essa entrega). Mesmo
   *     canal físico: ninguém recebe antes do SUBSCRIBED — 0 consulta;
   *   - entra com ele caído (`errored`, `polling`, ou `joining` voltando de
   *     queda), ou ele cai depois — inclusive o 1º join que falha antes do
   *     SUBSCRIBED: no SUBSCRIBED seguinte agenda todos os alvos uma vez,
   *     sempre — o que chegou na queda caiu para todas.
   *     N instâncias no mesmo canal = N pedidos do mesmo instante; o agendador
   *     faz no máximo 1 busca por query.
   * O prazo é o de um evento (`quietMs`, `maxWaitMs`, stagger, `minAgeMs`,
   * `whenHidden`); fetch em voo é esperado, nunca cancelado. Lido na entrada
   * no canal.
   */
  catchUpOnSubscribe?: boolean;
}

/**
 * Onde o canal está, visto desta instância desde que ela entrou nele.
 * `joining` = 1º join do canal ainda sem SUBSCRIBED e sem falha; `lost` =
 * caído (já estava quando ela entrou, ou caiu depois — inclusive no 1º join).
 */
interface SubscribeLink {
  /** Canal lógico (tabela + filtro); `null` = sem opt-in na entrada. */
  channelKey: string | null;
  /** Sequência tirada quando esta instância entrou no canal. */
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
      // Uma sequência por EVENTO: as N instâncias do canal compartilhado
      // recebem o mesmo objeto e pedem com o mesmo número.
      const eventSeq = recordRealtimeDelivery(queryClient, channelKeyRef.current, payload);
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
      enqueue(requested, normalized, eventSeq);
    },
    [queryClient, enqueue]
  );

  // Compute filter — org-based for most tables, none for TABLES_WITHOUT_ORG_ID
  const canFilter = !TABLES_WITHOUT_ORG_ID.has(table) && !!organizationId;
  const filter = canFilter ? `organization_id=eq.${organizationId}` : undefined;
  const enabled = options?.enabled ?? true;
  const channelKey = `${table}|${filter ?? "*"}`;
  channelKeyRef.current = channelKey;

  // Recuperação no SUBSCRIBED (opt-in). Movida pelas TRANSIÇÕES do canal,
  // entregues na hora pelo transporte — não pelo `state` do render, que não
  // muda (nem re-renderiza) quando a troca de chave cai num canal que outra
  // instância já tem `joined`.
  const catchUpKeyRef = useRef<string | null>(null);
  catchUpKeyRef.current = options?.catchUpOnSubscribe && enabled ? channelKey : null;
  const linkRef = useRef<SubscribeLink>({ channelKey: null, since: 0, phase: "live" });

  const handleStateChange = useCallback(
    ({ state, failureCount, initial }: ChannelStateChange) => {
      if (initial) {
        // A entrada chega dentro do acquire, no commit cuja chave está no ref.
        const fallen = state === "errored" || state === "polling" || (state === "joining" && failureCount > 0);
        linkRef.current = {
          channelKey: catchUpKeyRef.current,
          since: nextRealtimeSeq(),
          phase: state === "joined" ? "live" : fallen ? "lost" : "joining",
        };
        return;
      }
      const link = linkRef.current;
      if (link.channelKey === null) return;
      if (state !== "joined") {
        // Queda é `lost` em QUALQUER fase — inclusive no 1º join: o que entrou
        // no banco no vão não chegou a canal nenhum. `joining` só derruba quem
        // estava `live`; no 1º join ou já `lost`, é o join em voo.
        if (link.phase === "live" || state === "errored" || state === "polling") link.phase = "lost";
        return;
      }
      if (link.phase === "live") return;
      const rejoined = link.phase === "lost";
      link.phase = "live";
      if (!optionsRef.current?.catchUpOnSubscribe) return;
      // 1º join que deu certo: só refaz se OUTRO canal físico da mesma chave
      // lógica recebeu evento no vão. Hoje não dispara em prod: o registry põe
      // toda instância desta chave no MESMO canal físico, e ninguém recebe
      // antes do SUBSCRIBED. É guarda para canal físico distinto na mesma
      // tabela + filtro — este hook repassar ao registry algo que entre na
      // chave dele (evento, circuito), ou transporte que não compartilhe.
      // Travada em `useRealtimeSubscription-refactored` ("outro canal físico
      // da mesma chave…").
      const seq = rejoined ? nextRealtimeSeq() : lastRealtimeDelivery(queryClient, link.channelKey);
      if (!rejoined && seq <= link.since) return;
      const normalized = targetsRef.current.filter((t) => t != null).map(normalizeTarget);
      if (normalized.length === 0) return;
      enqueue(normalized.map((_, i) => i), normalized, seq);
    },
    [queryClient, enqueue]
  );

  useRealtimeChannel({
    table,
    filter,
    onEvent: handleRealtimeEvent,
    onStateChange: handleStateChange,
    enabled,
  });
}
