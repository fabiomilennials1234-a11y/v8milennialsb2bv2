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
 *     viram 3 reconexões. Toda reabertura cancela os timers pendentes (1 canal
 *     novo por reconexão); visibilidade/online só reabre canal errored/polling.
 *   - `realtimeStatusStore`: cada chave de status distinta (statusKey do
 *     consumidor, ou `rt_{tabela}_{filtro}` sem statusKey) recebe UMA
 *     transição por transição real do canal. `joinCount` sobe 1× por join
 *     real — é o que `chatReconcile` lê. Um consumidor que entra num canal já
 *     vivo com uma statusKey ainda não vista registra o estado dessa chave
 *     (equivale ao canal novo que ele abriria antes); com statusKey já vista,
 *     nada muda no store.
 *   - threshold/cooldown entram na chave: configurações diferentes não se
 *     misturam (todos os chamadores de prod usam o padrão).
 *
 * Broadcast privado (perf S1, 2026-10-19 — `broadcastTransport.ts`): com
 * `spec.topic`, o canal é o tópico privado da org e a chave é o TÓPICO, não o
 * filtro — o servidor só conhece o tópico e o supabase-js devolve o canal
 * existente quando ele se repete. Cada assinante carrega o seu filtro `eq`,
 * aplicado no cliente antes de entregar. Mesma máquina de estado; reabrir
 * espera o canal anterior do mesmo tópico sair (leave assíncrono).
 */
import type {
  RealtimeChannel,
  RealtimePostgresChangesFilter,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { envelopeToPayload, parseEqFilter, payloadMatches, type EqFilter } from "./broadcastTransport";
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
  /** Tópico privado do Broadcast. Ausente = `postgres_changes`. */
  topic?: string;
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
/** Teto da espera pelo leave de um tópico (o push de leave do realtime-js expira em 10 s). */
const LEAVE_WAIT_MAX_MS = 10_000;
const BASE_BACKOFF_MS = 1_000;
const DEDUP_WINDOW_MS = 1_000;

type TimerName = "backoffTimer" | "cooldownTimer" | "dedupTimer";

/** Assinante dentro do canal: chave de status e recorte já resolvidos. */
interface Member {
  sub: ChannelSubscriber;
  statusKey: string;
  /** Broadcast: filtro `eq` e evento aplicados no cliente. */
  match: EqFilter | null;
  event: PostgresChangeEvent;
}

interface Entry {
  key: string;
  table: string;
  filter?: string;
  event: PostgresChangeEvent;
  threshold: number;
  cooldownMs: number;
  topic: string | null;
  members: Set<Member>;
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

/** Broadcast: saída (leave) em voo por tópico. O próximo join do tópico espera. */
const leaving = new Map<string, Promise<void>>();

export function realtimeChannelKey(spec: ChannelSpec): string {
  // Broadcast: UMA entrada por tópico (o cliente só aceita um canal por
  // tópico). Configuração de circuito diferente no mesmo tópico usa a do
  // primeiro a entrar — duas entradas se derrubariam no detachStale.
  if (spec.topic) return ["bc", spec.topic, spec.table].join("|");
  return [spec.table, spec.filter ?? "*", spec.event ?? "*", spec.threshold, spec.cooldownMs].join("|");
}

function defaultStatusKey(spec: Pick<ChannelSpec, "table" | "filter">): string {
  return `rt_${spec.table}_${spec.filter ?? "all"}`;
}

function statusKeys(entry: Entry): Set<string> {
  const keys = new Set<string>();
  for (const m of entry.members) keys.add(m.statusKey);
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
  for (const m of [...entry.members]) m.sub.onTransition(full);
}

function dispatch(entry: Entry, payload: RealtimePostgresChangesPayload<Row>) {
  // Um consumidor que lança não pode roubar o evento dos outros; o primeiro
  // erro é relançado depois para não sumir (mesma propagação de antes).
  let firstError: unknown = null;
  for (const m of [...entry.members]) {
    if (entry.topic) {
      if (m.event !== "*" && m.event !== payload.eventType) continue;
      if (!payloadMatches(payload, m.match)) continue;
    }
    try {
      m.sub.onEvent(payload);
    } catch (e) {
      firstError ??= e;
    }
  }
  if (firstError) throw firstError;
}

function handleStatus(entry: Entry, status: string, err?: Error) {
  if (status === "SUBSCRIBED") {
    // `circuitOpen` e não `state`: a sonda já passou o estado para "joining".
    const wasCircuitOpen = entry.circuitOpen;
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
    notify(entry, { state: "joined", type: wasCircuitOpen ? "circuit_close" : "transition" });
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
  // Broadcast não tem essa saída: o nome É o tópico autorizado no servidor.
  entry.channelName = entry.topic ?? `rt_${entry.table}_${entry.filter ?? "all"}_${crypto.randomUUID()}`;
  entry.state = "joining";
  for (const k of statusKeys(entry)) setChannelState(k, "joining", undefined);
  notify(entry, { state: "joining", type: "transition" });

  if (entry.topic) {
    openBroadcast(entry, generation);
    return;
  }

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

function openBroadcast(entry: Entry, generation: number) {
  const topic = entry.topic!;
  const live = () => entries.get(entry.key) === entry && entry.generation === generation;
  const join = () => {
    if (!live()) return;
    detachStale(topic);
    const channel = supabase.channel(topic, { config: { private: true } });
    entry.channel = channel;
    channel
      .on("broadcast", { event: entry.table }, (message: { payload?: unknown }) => {
        if (!live()) return;
        const payload = envelopeToPayload(entry.table, message?.payload);
        if (payload) dispatch(entry, payload);
      })
      .subscribe((status: string, err?: Error) => {
        if (live()) handleStatus(entry, status, err);
      });
  };
  const pending = leaving.get(topic);
  if (pending) void pending.then(join);
  else join();
}

/**
 * Canal do mesmo tópico que ficou na lista do cliente (leave respondido com
 * erro não o tira de lá): `supabase.channel(topic)` o devolveria e o
 * `.subscribe` lançaria "subscribe multiple times". `_remove` é interno do
 * realtime-js (2.89) — sem ele, segue (o join falha e o backoff tenta de novo).
 */
function detachStale(topic: string) {
  const client = supabase as unknown as {
    getChannels?: () => Array<{ topic: string }>;
    realtime?: { _remove?: (ch: unknown) => void };
  };
  const stale = client.getChannels?.().find((c) => c.topic === `realtime:${topic}`);
  if (stale) client.realtime?._remove?.(stale);
}

function close(entry: Entry) {
  const ch = entry.channel;
  entry.channel = null;
  if (!ch) return;
  if (!entry.topic) {
    supabase.removeChannel(ch);
    return;
  }
  const topic = entry.topic;
  let leave: Promise<unknown>;
  try {
    leave = Promise.resolve(supabase.removeChannel(ch));
  } catch {
    leave = Promise.resolve();
  }
  let cap: ReturnType<typeof setTimeout> | undefined;
  const capped = Promise.race([
    leave.catch(() => undefined),
    new Promise<void>((r) => {
      cap = setTimeout(r, LEAVE_WAIT_MAX_MS);
    }),
  ]);
  const done: Promise<void> = capped
    .then(() => clearTimeout(cap))
    .then(() => {
      if (leaving.get(topic) === done) leaving.delete(topic);
    });
  leaving.set(topic, done);
}

function reopen(entry: Entry) {
  if (entries.get(entry.key) !== entry) return;
  // Uma reabertura vale por todas as pendentes: backoff, sonda e dedup de
  // visibilidade que vencessem depois matariam este join em voo (QA e3).
  clearTimer(entry, "backoffTimer");
  clearTimer(entry, "cooldownTimer");
  clearTimer(entry, "dedupTimer");
  close(entry);
  open(entry);
}

const isDown = (entry: Entry) => entry.state === "errored" || entry.state === "polling";

export function acquireRealtimeChannel(spec: ChannelSpec, subscriber: ChannelSubscriber): ChannelHandle {
  const key = realtimeChannelKey(spec);
  let entry = entries.get(key);
  const member: Member = {
    sub: subscriber,
    statusKey: subscriber.statusKey ?? defaultStatusKey(spec),
    match: spec.topic && spec.filter ? parseEqFilter(spec.filter) : null,
    event: spec.event ?? "*",
  };
  if (spec.topic && spec.filter && !member.match) {
    // `useRealtimeTransport` só manda para o broadcast filtro `eq`; outro
    // formato aqui entregaria a org inteira a quem pediu um recorte.
    throw new Error(`realtime broadcast: filtro não suportado "${spec.filter}"`);
  }

  if (!entry) {
    entry = {
      key,
      table: spec.table,
      filter: spec.topic ? undefined : spec.filter,
      event: spec.topic ? "*" : spec.event ?? "*",
      threshold: spec.threshold,
      cooldownMs: spec.cooldownMs,
      topic: spec.topic ?? null,
      members: new Set([member]),
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
    const sk = member.statusKey;
    const keyIsNew = !statusKeys(entry).has(sk);
    entry.members.add(member);
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
      owned.members.delete(member);
      if (owned.members.size > 0 || entries.get(key) !== owned) return;
      entries.delete(key);
      clearTimer(owned, "backoffTimer");
      clearTimer(owned, "cooldownTimer");
      clearTimer(owned, "dedupTimer");
      close(owned);
    },
    requestReconnect() {
      // Só canal caído reabre. "joining" é join em voo: reabrir o mataria e
      // custaria outro join no servidor sob carga; "joined" está saudável.
      if (released || !isDown(owned) || owned.dedupTimer) return;
      owned.dedupTimer = setTimeout(() => {
        owned.dedupTimer = null;
        if (isDown(owned)) reopen(owned);
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
  return [...entries.values()].map((e) => ({ key: e.key, subscribers: e.members.size, state: e.state }));
}
