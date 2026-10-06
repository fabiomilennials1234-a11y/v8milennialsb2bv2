/**
 * Agendador de invalidações vindas do realtime — UM por QueryClient.
 *
 * ── O PROBLEMA ────────────────────────────────────────────────────────────
 * Em 2026-10-05 a tela de Leads respondia por 60% do tempo do banco de prod.
 * Três causas, todas no cliente:
 *   1. cada instância de `useRealtimeSubscription` invalidava por conta própria:
 *      N abas/hooks no mesmo alvo = N refetches do mesmo evento;
 *   2. `invalidateQueries` cancelava o fetch em voo e recomeçava
 *      (`cancelRefetch: true` é o padrão do TanStack) — sob rajada, a mesma
 *      consulta pesada era abortada e reiniciada em série;
 *   3. não havia como dizer "esta contagem pode esperar um minuto".
 *
 * ── O QUE ESTE MÓDULO FAZ ─────────────────────────────────────────────────
 * O hook continua dono do QUANDO (debounce + stagger, exatamente como antes).
 * Este módulo decide o SE, no instante do disparo, alvo a alvo:
 *
 *   - **frescor por query**: todo fetch ganha, ao COMEÇAR, um número de
 *     sequência (ouvido no QueryCache); o número só vira frescor quando o
 *     RESULTADO desse fetch chega (`success`). Um pedido de invalidação
 *     carrega a sequência do evento que o motivou: query cujo resultado em
 *     cache veio de um fetch que começou DEPOIS do evento já reflete o evento
 *     e não é refeita. É isto que coalesce duas instâncias no mesmo alvo, e
 *     também absorve o refetch que uma mutação acabou de fazer.
 *     Não contam: `fetchNextPage`/`fetchPreviousPage` (só buscam a página
 *     nova — as do cache ficam com o retrato antigo), fetch que falhou ou foi
 *     cancelado com `revert` (o cache voltou ao que era) e `setQueryData`
 *     (não é retrato do banco);
 *   - **fetch em voo**: se a query está buscando, refazer agora seria cancelar
 *     (padrão) ou deduplicar contra um resultado que pode ser velho
 *     (`cancelRefetch: false`). O pedido espera o QueryCache avisar que o
 *     fetch terminou e decide de novo NA HORA — sem relógio de re-tentativa;
 *   - **opt-in `minAgeMs`** (por alvo): query mais nova que isso espera
 *     completar a idade — e então refaz UMA vez. Throttle, não descarte: a
 *     contagem fica no máximo `minAgeMs` atrasada, nunca para sempre;
 *   - **opt-in `whenHidden: "defer"`**: com a aba oculta o pedido fica
 *     guardado; um único listener de `visibilitychange` (vivo só enquanto há
 *     pedido guardado) dispara tudo ao voltar. O padrão é `"flush"`, que é o
 *     comportamento de sempre: aba oculta também refaz.
 *
 * Toda invalidação sai com `refetchType: "active"` e `cancelRefetch: false`.
 *
 * ── CICLO DE VIDA ─────────────────────────────────────────────────────────
 * O agendador ouve o QueryCache enquanto alguém precisa dele: há hook montado
 * (`retainInvalidationScheduler`) OU pedido pendente. Sem nenhum dos dois, a
 * inscrição no cache sai e o estado vai junto — desmontar a última tela com
 * realtime não deixa listener, timer nem `visibilitychange` para trás.
 * Frescor perdido nesse meio-tempo é o caso conservador: query sem registro
 * conta como velha e é refeita.
 *
 * ── ENTREGAS (recuperação no SUBSCRIBED) ──────────────────────────────────
 * Cada instância de `useRealtimeSubscription` abre o PRÓPRIO canal, com join
 * independente: evento que chega enquanto o canal de uma instância ainda está
 * "joining" vai para as irmãs e se perde para ela. O agendador guarda, por
 * canal lógico (tabela + filtro), a sequência da última entrega a QUALQUER
 * instância (`recordRealtimeDelivery`). Quem fica SUBSCRIBED pela primeira vez
 * compara com o instante em que começou a entrar (`lastRealtimeDelivery`).
 * Vive e morre com o resto do estado: sem hook montado, sem registro.
 *
 * ── O QUE NÃO MUDA ────────────────────────────────────────────────────────
 * Nada aqui toca o transporte (`useRealtimeChannel`), o filtro de org nem a
 * lista de tabelas sem `organization_id`. Este módulo só vê o cache.
 *
 * Sem import de VALOR de `@tanstack/react-query`: dezenas de testes do repo
 * dublam o pacote por lista de exports, e um `hashKey` importado aqui
 * quebraria todos eles em silêncio. O hash é o mesmo algoritmo do TanStack
 * (JSON com chaves de objeto ordenadas).
 */
import type { Query, QueryCacheNotifyEvent, QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Um alvo de invalidação.
 *   - `"leads"` ≡ `["leads"]` — a forma legada; uma string é UM segmento.
 *   - `["pipeline_entries", slug, org]` — prefixo composto.
 *   - `{ queryKey, minAgeMs }` — prefixo com idade mínima (opt-in).
 */
export type InvalidationTarget =
  | string
  | QueryKey
  | { readonly queryKey: QueryKey; readonly minAgeMs?: number };

export type WhenHidden = "flush" | "defer";

export interface NormalizedTarget {
  readonly queryKey: QueryKey;
  readonly minAgeMs: number;
  readonly hash: string;
}

/** Mesmo algoritmo de `hashKey` do TanStack: objetos com chaves ordenadas. */
export function hashTargetKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey, (_, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.keys(val)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (val as Record<string, unknown>)[k];
            return acc;
          }, {})
      : val,
  );
}

export function normalizeTarget(target: InvalidationTarget): NormalizedTarget {
  if (typeof target === "string") {
    const queryKey = [target] as const;
    return { queryKey, minAgeMs: 0, hash: hashTargetKey(queryKey) };
  }
  if (Array.isArray(target)) {
    return { queryKey: target, minAgeMs: 0, hash: hashTargetKey(target) };
  }
  const { queryKey, minAgeMs = 0 } = target as { queryKey: QueryKey; minAgeMs?: number };
  return { queryKey, minAgeMs: Math.max(0, minAgeMs), hash: hashTargetKey(queryKey) };
}

/**
 * Relógio lógico compartilhado por eventos e fetches. Sequência, e não
 * `Date.now()`: um fetch e um evento no mesmo milissegundo seriam empate, e
 * empate aqui decide se uma mudança aparece ou some.
 *
 * O registro do início do fetch é SÍNCRONO com o dispatch do TanStack (o
 * `QueryCache.notify` chama os listeners dentro do `batch`, sem agendar), então
 * nenhum evento do realtime cabe entre o fetch sair e o número ser tirado.
 */
let sequence = 0;
export function nextRealtimeSeq(): number {
  sequence += 1;
  return sequence;
}

export interface InvalidationRequest {
  /** Sequência do evento mais recente que motivou o pedido. */
  readonly eventSeq: number;
  readonly whenHidden: WhenHidden;
}

interface Entry {
  readonly queryKey: QueryKey;
  readonly hash: string;
  minAgeMs: number;
  pendingSeq: number;
  flushWhenHidden: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** Queries com fetch em voo que este pedido espera terminar. */
  readonly waitingOn: Set<Query>;
}

interface ClientScheduler {
  readonly client: QueryClient;
  readonly entries: Map<string, Entry>;
  /** Sequência do INÍCIO do fetch cujo resultado está no cache (ou da invalidação de query inativa). */
  readonly freshSince: WeakMap<Query, number>;
  /** Sequência do início do fetch em voo — vira frescor só no `success`. */
  readonly fetchStart: WeakMap<Query, number>;
  /** Pedidos esperando o fetch em voo de cada query terminar. */
  readonly waitingFetch: Map<Query, Set<Entry>>;
  readonly waitingVisible: Set<Entry>;
  /** Sequência da última entrega de evento, por canal lógico (tabela + filtro). */
  readonly delivered: Map<string, number>;
  onVisibility: (() => void) | null;
  /** Hooks montados que dependem deste agendador. */
  holders: number;
  readonly unsubscribe: () => void;
}

const schedulers = new WeakMap<QueryClient, ClientScheduler>();

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Prende o agendador do client enquanto o chamador estiver montado; devolve a
 * soltura. `useRealtimeSubscription` chama num layout effect — antes de
 * qualquer effect passivo, onde as queries da mesma tela disparam o fetch
 * inicial —, para que esses fetches já fiquem registrados.
 */
export function retainInvalidationScheduler(client: QueryClient): () => void {
  const scheduler = getScheduler(client);
  scheduler.holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scheduler.holders -= 1;
    disposeIfIdle(scheduler);
  };
}

function getScheduler(client: QueryClient): ClientScheduler {
  const existing = schedulers.get(client);
  if (existing) return existing;

  const freshSince = new WeakMap<Query, number>();
  const fetchStart = new WeakMap<Query, number>();
  const waitingFetch = new Map<Query, Set<Entry>>();

  const onCacheEvent = (event: QueryCacheNotifyEvent) => {
    const { query } = event;
    if (event.type === "removed") {
      fetchStart.delete(query);
      wake(scheduler, query);
      return;
    }
    if (event.type !== "updated") return;
    const { action } = event;
    if (action.type === "fetch") {
      // `fetchNextPage`/`fetchPreviousPage` só buscam a página nova: as que já
      // estão no cache continuam com o retrato antigo.
      if (action.meta?.fetchMore) fetchStart.delete(query);
      else fetchStart.set(query, nextRealtimeSeq());
      return;
    }
    if (action.type === "success" && !action.manual) {
      const start = fetchStart.get(query);
      if (start !== undefined && start > (freshSince.get(query) ?? 0)) freshSince.set(query, start);
    }
    // Terminou — com resultado, erro, cancelamento com revert ou reset. Sem
    // `success` não-manual antes, nada virou frescor.
    if (query.state.fetchStatus === "idle") {
      fetchStart.delete(query);
      wake(scheduler, query);
    }
  };

  const scheduler: ClientScheduler = {
    client,
    entries: new Map(),
    freshSince,
    fetchStart,
    waitingFetch,
    waitingVisible: new Set(),
    delivered: new Map(),
    onVisibility: null,
    holders: 0,
    unsubscribe: client.getQueryCache().subscribe(onCacheEvent),
  };
  schedulers.set(client, scheduler);
  return scheduler;
}

function disposeIfIdle(scheduler: ClientScheduler): void {
  if (scheduler.holders > 0 || scheduler.entries.size > 0) return;
  scheduler.unsubscribe();
  detach(scheduler);
  if (schedulers.get(scheduler.client) === scheduler) schedulers.delete(scheduler.client);
}

/**
 * Pede a invalidação de um alvo. Idempotente por evento: pedir duas vezes pelo
 * mesmo evento (duas instâncias, dois canais) invalida uma.
 */
export function requestInvalidation(
  client: QueryClient,
  target: NormalizedTarget,
  request: InvalidationRequest,
): void {
  const scheduler = getScheduler(client);
  let entry = scheduler.entries.get(target.hash);
  if (!entry) {
    entry = {
      queryKey: target.queryKey,
      hash: target.hash,
      minAgeMs: target.minAgeMs,
      pendingSeq: 0,
      flushWhenHidden: false,
      timer: null,
      waitingOn: new Set(),
    };
    scheduler.entries.set(target.hash, entry);
  } else {
    // Pedidos diferentes no mesmo alvo: vence o mais ansioso. Quem não fez
    // opt-in nunca fica mais lento por causa de quem fez.
    entry.minAgeMs = Math.min(entry.minAgeMs, target.minAgeMs);
  }
  entry.pendingSeq = Math.max(entry.pendingSeq, request.eventSeq);
  if (request.whenHidden === "flush") entry.flushWhenHidden = true;
  attempt(scheduler, entry);
}

/**
 * Invalida a chave EXATA levando em conta o fetch em voo, sem debounce — para
 * quem já decidiu que ela está velha. Ociosa: marcada já (ativa refaz,
 * inativa só busca ao voltar). Buscando: o retrato dela é de antes de agora e
 * o sucesso do TanStack zeraria a marca; espera terminar e só então decide.
 */
export function invalidateOnceSettled(client: QueryClient, queryKey: QueryKey, whenHidden: WhenHidden = "flush"): void {
  requestInvalidation(client, normalizeTarget(queryKey), { eventSeq: nextRealtimeSeq(), whenHidden });
}

/**
 * Registra que um evento do canal lógico `channelKey` (tabela + filtro) foi
 * entregue a alguma instância agora. Só anota — não invalida nada. Sem
 * agendador vivo (nenhum hook montado) não há quem vá perguntar: não anota.
 */
export function recordRealtimeDelivery(client: QueryClient, channelKey: string): void {
  const scheduler = schedulers.get(client);
  if (scheduler) scheduler.delivered.set(channelKey, nextRealtimeSeq());
}

/** Sequência da última entrega em `channelKey` (0 = nenhuma desde que o agendador nasceu). */
export function lastRealtimeDelivery(client: QueryClient, channelKey: string): number {
  return schedulers.get(client)?.delivered.get(channelKey) ?? 0;
}

function clearTimer(entry: Entry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
}

function settle(scheduler: ClientScheduler, entry: Entry): void {
  clearTimer(entry);
  unwaitFetch(scheduler, entry);
  scheduler.entries.delete(entry.hash);
  unwatchVisibility(scheduler, entry);
  disposeIfIdle(scheduler);
}

function attempt(scheduler: ClientScheduler, entry: Entry): void {
  clearTimer(entry);
  unwaitFetch(scheduler, entry);

  const { client, freshSince } = scheduler;
  const queries = client.getQueryCache().findAll({ queryKey: entry.queryKey });
  // Só o que ainda NÃO viu o evento. Resultado de fetch que começou depois dele já está certo.
  const stale = queries.filter((q) => (freshSince.get(q) ?? 0) <= entry.pendingSeq);
  if (stale.length === 0) {
    settle(scheduler, entry);
    return;
  }

  if (!entry.flushWhenHidden && isDocumentHidden()) {
    watchVisibility(scheduler, entry);
    return;
  }
  unwatchVisibility(scheduler, entry);

  const now = Date.now();
  const ready: Query[] = [];
  const inFlight: Query[] = [];
  let wait = Number.POSITIVE_INFINITY;
  for (const q of stale) {
    // `paused` (offline) também: o fetch pausado retoma com o retrato de antes.
    if (q.state.fetchStatus !== "idle") {
      inFlight.push(q);
      continue;
    }
    const updatedAt = q.state.dataUpdatedAt;
    if (entry.minAgeMs > 0 && updatedAt > 0 && now - updatedAt < entry.minAgeMs) {
      wait = Math.min(wait, updatedAt + entry.minAgeMs - now);
      continue;
    }
    ready.push(q);
  }

  if (ready.length > 0) {
    const batch = new Set(ready);
    // Inativa não busca agora (só fica inválida e busca ao montar): o pedido
    // já a serve, e ela não pode ser re-invalidada por este mesmo evento.
    // Ativa só conta como servida quando o fetch que isto dispara CHEGAR.
    const seq = nextRealtimeSeq();
    for (const q of ready) if (!q.isActive()) freshSince.set(q, seq);
    void client.invalidateQueries(
      { queryKey: entry.queryKey, refetchType: "active", predicate: (q) => batch.has(q) },
      { cancelRefetch: false },
    );
  }

  for (const q of inFlight) waitFetch(scheduler, entry, q);
  if (wait !== Number.POSITIVE_INFINITY) {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      attempt(scheduler, entry);
    }, Math.max(0, wait));
  }
  if (inFlight.length === 0 && wait === Number.POSITIVE_INFINITY) settle(scheduler, entry);
}

function waitFetch(scheduler: ClientScheduler, entry: Entry, query: Query): void {
  let waiting = scheduler.waitingFetch.get(query);
  if (!waiting) {
    waiting = new Set();
    scheduler.waitingFetch.set(query, waiting);
  }
  waiting.add(entry);
  entry.waitingOn.add(query);
}

function unwaitFetch(scheduler: ClientScheduler, entry: Entry): void {
  for (const query of entry.waitingOn) {
    const waiting = scheduler.waitingFetch.get(query);
    if (!waiting) continue;
    waiting.delete(entry);
    if (waiting.size === 0) scheduler.waitingFetch.delete(query);
  }
  entry.waitingOn.clear();
}

/** O fetch em voo de `query` terminou: quem esperava por ele decide de novo. */
function wake(scheduler: ClientScheduler, query: Query): void {
  const waiting = scheduler.waitingFetch.get(query);
  if (!waiting) return;
  scheduler.waitingFetch.delete(query);
  for (const entry of waiting) {
    entry.waitingOn.delete(query);
    // Fora do dispatch do TanStack: refazer aqui dentro reentraria no fetch
    // que acabou de terminar, antes de ele fechar o próprio ciclo.
    clearTimer(entry);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      attempt(scheduler, entry);
    }, 0);
  }
}

function watchVisibility(scheduler: ClientScheduler, entry: Entry): void {
  scheduler.waitingVisible.add(entry);
  if (scheduler.onVisibility || typeof document === "undefined") return;
  const onVisibility = () => {
    if (isDocumentHidden()) return;
    const waiting = [...scheduler.waitingVisible];
    scheduler.waitingVisible.clear();
    detach(scheduler);
    for (const e of waiting) attempt(scheduler, e);
  };
  scheduler.onVisibility = onVisibility;
  document.addEventListener("visibilitychange", onVisibility);
}

function unwatchVisibility(scheduler: ClientScheduler, entry: Entry): void {
  if (!scheduler.waitingVisible.delete(entry)) return;
  if (scheduler.waitingVisible.size === 0) detach(scheduler);
}

function detach(scheduler: ClientScheduler): void {
  if (scheduler.onVisibility && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", scheduler.onVisibility);
  }
  scheduler.onVisibility = null;
}

/** A aba está oculta agora? Exposto para o hook decidir o atalho do "defer". */
export function isRealtimeTabHidden(): boolean {
  return isDocumentHidden();
}
