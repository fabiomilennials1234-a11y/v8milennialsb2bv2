/**
 * realtimeChannelRegistry — UMA assinatura `postgres_changes` por
 * (tabela, filtro, evento) por aba, compartilhada por refcount.
 *
 * Por que existe (perf S0, 2026-10-06): cada `useRealtimeChannel` abria o seu
 * canal (nome com randomUUID). Medido em prod: 551 assinaturas vivas para 30
 * usuários, das quais só 286 eram pares distintos (usuário, tabela, filtro) —
 * `pipeline_stages` 111 assinaturas para 18 pares. Cada canal é um join no
 * Realtime (`with sub_tables…` + INSERT em `realtime.subscription`) e um
 * `apply_rls` por evento por assinante.
 *
 * Contrato:
 *   - Consumidores com a mesma chave dividem 1 canal e recebem o MESMO evento.
 *   - O último a sair fecha o canal (síncrono: comportamento idêntico ao
 *     anterior no unmount; StrictMode abre → fecha → abre).
 *   - A máquina de estado (backoff exponencial, circuit breaker N falhas →
 *     polling + sonda após cooldown, reconexão por visibilidade/online com
 *     janela de dedup) mora no CANAL, não no consumidor: 3 consumidores não
 *     viram 3 reconexões.
 *   - `realtimeStatusStore`: cada chave de status distinta (statusKey do
 *     consumidor, ou `rt_{tabela}_{filtro}` sem statusKey) recebe UMA
 *     transição por transição real do canal. `joinCount` sobe 1× por join
 *     real — é o que `chatReconcile` lê. Um consumidor que entra num canal já
 *     vivo com uma statusKey ainda não vista registra o estado dessa chave
 *     (equivale ao canal novo que ele abriria antes); com statusKey já vista,
 *     nada muda no store.
 *   - threshold/cooldown entram na chave: configurações diferentes não se
 *     misturam (todos os chamadores de prod usam o padrão).
 */
import type {
  RealtimeChannel,
  RealtimePostgresChangesFilter,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  incrementFailures,
  openCircuitBreaker,
  resetFailures,
  setChannelState,
} from "@/lib/realtimeStatusStore";

type Row = Record<string, unknown>;

export type SharedChannelState = "joining" | "joined" | "errored" | "polling";
export type PostgresChangeEvent = "*" | "INSERT" | "UPDATE" | "DELETE";

export interface ChannelSpec {
  table: string;
  filter?: string;
  event?: PostgresChangeEvent;
  threshold: number;
  cooldownMs: number;
}

export interface ChannelTransition {
  state: SharedChannelState;
  channelName: string;
  failureCount: number;
  type: "transition" | "circuit_open" | "circuit_close";
  error?: string;
}

export interface ChannelSubscriber {
  statusKey?: string;
  onEvent: (payload: RealtimePostgresChangesPayload<Row>) => void;
  onTransition: (transition: ChannelTransition) => void;
}

export interface ChannelHandle {
  release: () => void;
  /** Visibilidade/online: reconecta se o canal não está saudável (dedup 1 s). */
  requestReconnect: () => void;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const DEDUP_WINDOW_MS = 1_000;

type TimerName = "backoffTimer" | "cooldownTimer" | "dedupTimer";

interface Entry {
  key: string;
  table: string;
  filter?: string;
  event: PostgresChangeEvent;
  threshold: number;
  cooldownMs: number;
  defaultStatusKey: string;
  subscribers: Set<ChannelSubscriber>;
  channel: RealtimeChannel | null;
  channelName: string;
  generation: number;
  state: SharedChannelState;
  lastError?: string;
  failureCount: number;
  circuitOpen: boolean;
  backoffTimer: ReturnType<typeof setTimeout> | null;
  cooldownTimer: ReturnType<typeof setTimeout> | null;
  dedupTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();

export function realtimeChannelKey(spec: ChannelSpec): string {
  return [spec.table, spec.filter ?? "*", spec.event ?? "*", spec.threshold, spec.cooldownMs].join("|");
}

function statusKeys(entry: Entry): Set<string> {
  const keys = new Set<string>();
  for (const s of entry.subscribers) keys.add(s.statusKey ?? entry.defaultStatusKey);
  return keys;
}

function clearTimer(entry: Entry, name: TimerName) {
  const t = entry[name];
  if (t) clearTimeout(t);
  entry[name] = null;
}

function notify(entry: Entry, transition: Omit<ChannelTransition, "channelName" | "failureCount">) {
  const full: ChannelTransition = {
    ...transition,
    channelName: entry.channelName,
    failureCount: entry.failureCount,
  };
  for (const s of [...entry.subscribers]) s.onTransition(full);
}

function dispatch(entry: Entry, payload: RealtimePostgresChangesPayload<Row>) {
  // Um consumidor que lança não pode roubar o evento dos outros; o primeiro
  // erro é relançado depois para não sumir (mesma propagação de antes).
  let firstError: unknown = null;
  for (const s of [...entry.subscribers]) {
    try {
      s.onEvent(payload);
    } catch (e) {
      firstError ??= e;
    }
  }
  if (firstError) throw firstError;
}

function handleStatus(entry: Entry, status: string, err?: Error) {
  if (status === "SUBSCRIBED") {
    const wasPolling = entry.state === "polling";
    entry.failureCount = 0;
    entry.circuitOpen = false;
    entry.state = "joined";
    entry.lastError = undefined;
    clearTimer(entry, "backoffTimer");
    clearTimer(entry, "cooldownTimer");
    for (const k of statusKeys(entry)) {
      resetFailures(k);
      setChannelState(k, "joined", undefined);
    }
    notify(entry, { state: "joined", type: wasPolling ? "circuit_close" : "transition" });
    return;
  }

  if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;

  const errorMsg = err?.message ?? status;
  entry.failureCount += 1;
  entry.lastError = errorMsg;
  const keys = statusKeys(entry);
  for (const k of keys) incrementFailures(k, errorMsg);

  if (entry.circuitOpen || entry.failureCount >= entry.threshold) {
    entry.circuitOpen = true;
    entry.state = "polling";
    for (const k of keys) {
      openCircuitBreaker(k, errorMsg);
      setChannelState(k, "polling", errorMsg);
    }
    notify(entry, { state: "polling", type: "circuit_open", error: errorMsg });
    clearTimer(entry, "cooldownTimer");
    entry.cooldownTimer = setTimeout(() => {
      entry.cooldownTimer = null;
      reopen(entry);
    }, entry.cooldownMs);
  } else {
    entry.state = "errored";
    for (const k of keys) setChannelState(k, "errored", errorMsg);
    notify(entry, { state: "errored", type: "transition", error: errorMsg });
    clearTimer(entry, "backoffTimer");
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (entry.failureCount - 1), MAX_BACKOFF_MS);
    entry.backoffTimer = setTimeout(() => {
      entry.backoffTimer = null;
      reopen(entry);
    }, delay);
  }
}

function open(entry: Entry) {
  entry.generation += 1;
  const generation = entry.generation;
  // Nome único por geração: supabase-js devolve o canal EXISTENTE quando o
  // tópico se repete, e o canal recém-removido ainda pode estar saindo.
  entry.channelName = `rt_${entry.table}_${entry.filter ?? "all"}_${crypto.randomUUID()}`;
  entry.state = "joining";
  for (const k of statusKeys(entry)) setChannelState(k, "joining", undefined);
  notify(entry, { state: "joining", type: "transition" });

  // O overload de `.on` amarra o literal do evento ao tipo do filtro; o
  // evento aqui é dado de runtime (chave do canal), daí a asserção.
  const config = {
    event: entry.event,
    schema: "public",
    table: entry.table,
    ...(entry.filter && { filter: entry.filter }),
  } as RealtimePostgresChangesFilter<"*">;

  // Callback de geração velha (CLOSED depois do removeChannel, evento em
  // trânsito) não pode mexer no estado do canal atual.
  const live = () => entries.get(entry.key) === entry && entry.generation === generation;

  const channel = supabase.channel(entry.channelName);
  entry.channel = channel;
  channel
    .on<Row>("postgres_changes", config, (payload) => {
      if (live()) dispatch(entry, payload);
    })
    .subscribe((status: string, err?: Error) => {
      if (live()) handleStatus(entry, status, err);
    });
}

function close(entry: Entry) {
  const ch = entry.channel;
  entry.channel = null;
  if (ch) supabase.removeChannel(ch);
}

function reopen(entry: Entry) {
  if (entries.get(entry.key) !== entry) return;
  close(entry);
  open(entry);
}

export function acquireRealtimeChannel(spec: ChannelSpec, subscriber: ChannelSubscriber): ChannelHandle {
  const key = realtimeChannelKey(spec);
  let entry = entries.get(key);

  if (!entry) {
    entry = {
      key,
      table: spec.table,
      filter: spec.filter,
      event: spec.event ?? "*",
      threshold: spec.threshold,
      cooldownMs: spec.cooldownMs,
      defaultStatusKey: `rt_${spec.table}_${spec.filter ?? "all"}`,
      subscribers: new Set([subscriber]),
      channel: null,
      channelName: "",
      generation: 0,
      state: "joining",
      failureCount: 0,
      circuitOpen: false,
      backoffTimer: null,
      cooldownTimer: null,
      dedupTimer: null,
    };
    entries.set(key, entry);
    open(entry);
  } else {
    const sk = subscriber.statusKey ?? entry.defaultStatusKey;
    const keyIsNew = !statusKeys(entry).has(sk);
    entry.subscribers.add(subscriber);
    const error = entry.state === "joined" ? undefined : entry.lastError;
    if (keyIsNew) setChannelState(sk, entry.state, error);
    subscriber.onTransition({
      state: entry.state,
      channelName: entry.channelName,
      failureCount: entry.failureCount,
      type: "transition",
      ...(error && { error }),
    });
  }

  const owned = entry;
  let released = false;

  return {
    release() {
      if (released) return;
      released = true;
      owned.subscribers.delete(subscriber);
      if (owned.subscribers.size > 0 || entries.get(key) !== owned) return;
      entries.delete(key);
      clearTimer(owned, "backoffTimer");
      clearTimer(owned, "cooldownTimer");
      clearTimer(owned, "dedupTimer");
      close(owned);
    },
    requestReconnect() {
      if (released || owned.state === "joined" || owned.dedupTimer) return;
      owned.dedupTimer = setTimeout(() => {
        owned.dedupTimer = null;
        if (owned.state !== "joined") reopen(owned);
      }, DEDUP_WINDOW_MS);
    },
  };
}

/** Diagnóstico e testes: canais vivos e consumidores por chave. */
export function realtimeChannelRegistrySnapshot(): Array<{
  key: string;
  subscribers: number;
  state: SharedChannelState;
}> {
  return [...entries.values()].map((e) => ({ key: e.key, subscribers: e.subscribers.size, state: e.state }));
}
