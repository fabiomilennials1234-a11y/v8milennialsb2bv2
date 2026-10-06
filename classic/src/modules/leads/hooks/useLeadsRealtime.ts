/**
 * Realtime da lista de Leads — UM canal em `leads`, classificado por evento.
 *
 * ── ANTES ─────────────────────────────────────────────────────────────────
 * `useLeads` assinava quatro tabelas. Três delas (`deals`, `pipeline_entries`,
 * `sale_events`) invalidavam lista + contagens + cards em todo evento — e
 * `deals` nem está na publicação `supabase_realtime` de prod. Somado ao
 * debounce de 2 s sem teto e sem regra de aba oculta, uma aba de Leads aberta
 * num escritório movimentado ia ao banco a cada poucos segundos, e cada ida
 * eram sete consultas (lista + 6 `count: exact`).
 *
 * ── AGORA ─────────────────────────────────────────────────────────────────
 *   - `leads` é a única fonte. A Relação chega por UPDATE em `leads`
 *     (`relacao_negocios` é gravada por trigger quando negócio/entrada/venda
 *     mudam), então `sale_events` e `pipeline_entries` saíram;
 *   - exceção: no piloto da Café Jurerê a gaveta é `classificacao_cafe_jurere`,
 *     CALCULADA na leitura a partir das entradas de funil — lá
 *     `pipeline_entries` continua assinada (e só lá);
 *   - cada evento passa por `classifyLeadEvent`: patch local, só contagens,
 *     ou tudo (ver `lib/lead-realtime-relevance`);
 *   - a lista espera 30 s de silêncio, com teto de 30 s sob rajada; as
 *     contagens e os cards só refazem com 60 s de idade; aba oculta guarda
 *     tudo e dispara uma vez ao voltar;
 *   - lista desligada (aba Clientes da página) não desliga o canal: as
 *     contagens das abas continuam na tela e continuam recebendo o evento;
 *   - página da tela buscando quando o evento chega: o retrato a caminho é de
 *     antes dele — todo veredito que pularia a lista (patch, contagens, DELETE
 *     de id fora do cache) a refaz depois desse fetch;
 *   - o canal é compartilhado por tabela + filtro: toda instância recebe o
 *     mesmo evento. Instância que entra com o canal caído, ou que o vê cair,
 *     refaz seus alvos no SUBSCRIBED seguinte (1 busca por query, por mais
 *     instâncias que haja) — `catchUpOnSubscribe` de `useRealtimeSubscription`.
 *
 * Os números: rajada de 20 eventos → 1 fetch da lista e 0 de contagem;
 * 2 min de eventos contínuos → ≤4 da lista e ≤1 por contagem a cada 60 s.
 * Medido em `tests/unit/leads-realtime-harness.test.tsx`.
 */
import { useQueryClient, type Query, type QueryKey } from "@tanstack/react-query";
import { useRealtimeSubscription, type RealtimeEventDecision } from "@/shared/realtime/useRealtimeSubscription";
import { invalidateOnceSettled } from "@/shared/realtime/invalidation-scheduler";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  applyLeadChanges,
  classifyLeadEvent,
  removeLead,
  type LeadRelacaoMode,
} from "../lib/lead-realtime-relevance";
import { leadsKeys } from "../lib/leads-query-keys";
import type { LeadListSort } from "../lib/lead-list-sort";

/** A lista: espera o silêncio, mas nunca mais que isso sob rajada. */
const LIST_QUIET_MS = 30_000;
const LIST_MAX_WAIT_MS = 30_000;
/** Contagens e cards: no máximo uma busca por minuto. */
const COUNTS_MIN_AGE_MS = 60_000;

export interface UseLeadsRealtimeParams {
  organizationId: string | null | undefined;
  /** A chave EXATA da página que esta instância mostra. */
  listKey: QueryKey;
  pageSize: number;
  sort: LeadListSort;
  mode: LeadRelacaoMode;
  /** Canal aberto (org resolvida). Contagens e cards dependem só disto. */
  enabled: boolean;
  /** A lista está ligada? Desligada, ela sai dos alvos — o canal fica. */
  listEnabled: boolean;
}

type Row = Record<string, unknown> & { id?: unknown };

export function useLeadsRealtime({
  organizationId,
  listKey,
  pageSize,
  sort,
  mode,
  enabled,
  listEnabled,
}: UseLeadsRealtimeParams) {
  const queryClient = useQueryClient();
  const listsPrefix = leadsKeys.lists(organizationId);
  const countsTarget = { queryKey: leadsKeys.counts(organizationId), minAgeMs: COUNTS_MIN_AGE_MS };
  const statsTarget = { queryKey: leadsKeys.allStats(organizationId), minAgeMs: COUNTS_MIN_AGE_MS };

  /** Páginas sem observer HABILITADO — inclui a lista desligada da aba Clientes. */
  const idleLists = (): Query[] =>
    queryClient.getQueryCache().findAll({ queryKey: listsPrefix, predicate: (q) => !q.isActive() });

  /**
   * Página ociosa com fetch em voo: o retrato dela é de antes deste evento e,
   * ao chegar, sobrescreve o cache e zera qualquer marca de velha. O
   * agendador espera esse fetch terminar e só então a marca.
   */
  const settleIdleInFlight = (idle: Query[]) => {
    for (const q of idle) {
      if (q.state.fetchStatus !== "idle") invalidateOnceSettled(queryClient, q.queryKey);
    }
  };

  /**
   * Páginas em cache que ninguém está olhando: ficam marcadas como velhas (sem
   * ir ao banco) para que voltar a elas busque de novo — o que a invalidação
   * ampla de antes garantia de graça.
   */
  const markIdleListsStale = () => {
    const idle = idleLists();
    settleIdleInFlight(idle);
    const quiet = new Set(idle.filter((q) => q.state.fetchStatus === "idle"));
    if (quiet.size === 0) return;
    void queryClient.invalidateQueries({ queryKey: listsPrefix, refetchType: "none", predicate: (q) => quiet.has(q) });
  };

  /**
   * Edição local (patch, remoção) página a página — nunca `setQueriesData` às
   * cegas: todo `setQueryData` é um `success` que zera a marca de velha e
   * renova a idade, mesmo quando devolve as mesmas linhas.
   *
   * Por página em cache:
   *   - ativa de OUTRA instância (picker, PriorityLeads): não mexe. O dono
   *     recebe este mesmo evento e o classifica contra a página dele — se ela
   *     já viesse editada daqui, ele concluiria "nada mudou" e não pediria o
   *     refetch de que o fetch em voo dela precisa. Toda página ativa tem
   *     dono: a única chave de lista é a de `useLeads`, que liga a query e
   *     este hook com a mesma chave e o mesmo `enabled`;
   *   - buscando: não mexe — o retrato a caminho é de antes do evento e
   *     sobrescreveria a edição. O refetch depois dele vem do chamador (a
   *     própria, pelo agendador) ou de `settleIdleInFlight` (as ociosas);
   *   - sem o lead: `edit` devolve as mesmas linhas e nada é despachado;
   *   - parada, com o lead: edita mantendo a idade (`updatedAt`) e, se estava
   *     marcada como velha, marca de novo — voltar a ela ainda busca.
   */
  const editIdleLists = (edit: (rows: Row[]) => Row[]) => {
    const cache = queryClient.getQueryCache();
    const own = cache.find({ queryKey: listKey, exact: true });
    for (const q of cache.findAll({ queryKey: listsPrefix })) {
      if (q !== own && q.isActive()) continue;
      if (q.state.fetchStatus !== "idle") continue;
      const rows = q.state.data;
      if (!Array.isArray(rows)) continue;
      const next = edit(rows as Row[]);
      if (next === rows) continue;
      const { dataUpdatedAt, isInvalidated } = q.state;
      queryClient.setQueryData(q.queryKey, next, { updatedAt: dataUpdatedAt });
      if (isInvalidated) {
        void queryClient.invalidateQueries({ queryKey: q.queryKey, exact: true, refetchType: "none" });
      }
    }
  };

  /**
   * A página da tela está buscando agora? O retrato a caminho foi tirado ANTES
   * deste commit: quando chegar, sobrescreve o cache sem o evento.
   */
  const ownListInFlight = () => {
    const fetchStatus = queryClient.getQueryState(listKey)?.fetchStatus;
    return fetchStatus !== undefined && fetchStatus !== "idle";
  };

  // Lido pelo transporte no momento do evento (via ref): sempre a página e a
  // ordem atuais, sem precisar de memo.
  const onEvent = (payload: RealtimePostgresChangesPayload<Row>): RealtimeEventDecision => {
    const verdict = classifyLeadEvent(payload, {
      organizationId,
      rows: queryClient.getQueryData<Row[]>(listKey),
      pageSize,
      sort,
      mode,
      isCached: (id) =>
        queryClient
          .getQueriesData<Row[]>({ queryKey: listsPrefix })
          .some(([, rows]) => Array.isArray(rows) && rows.some((row) => row.id === id)),
    });

    switch (verdict.kind) {
      case "ignore":
        // DELETE de id fora de todo cache: com a página da tela buscando, o
        // retrato a caminho pode trazer justamente esse lead.
        return payload.eventType === "DELETE" && ownListInFlight() ? { invalidate: [listKey] } : "skip";
      case "patch": {
        // Mudança fora de recorte: não muda pertença nem ordem em página
        // nenhuma — as paradas que têm a linha recebem o patch.
        editIdleLists((rows) => applyLeadChanges(rows, verdict.id, verdict.changes));
        settleIdleInFlight(idleLists());
        // A página da tela buscando agora tirou o retrato ANTES deste commit e
        // não recebeu o patch: a linha fica no valor antigo até o refetch,
        // pedido aqui e feito depois que esse fetch chegar, no prazo da lista
        // (até 30 s de silêncio). Trade-off aceito: patchar só para o fetch em
        // voo desfazer faria a linha piscar novo → antigo → novo.
        return ownListInFlight() ? { invalidate: [listKey] } : "skip";
      }
      case "counts":
        markIdleListsStale();
        // "Depois da última linha" foi decidido contra a página em cache. Com
        // ela buscando, a página a caminho é outra (e o lead pode estar nela):
        // a decisão não vale para ela — refaz depois desse fetch.
        return ownListInFlight()
          ? { invalidate: [listKey, countsTarget, statsTarget] }
          : { invalidate: [countsTarget, statsTarget] };
      case "remove":
        editIdleLists((rows) => removeLead(rows, verdict.id));
        markIdleListsStale();
        return "invalidate";
      case "refetch":
        markIdleListsStale();
        return "invalidate";
    }
  };

  // `catchUpOnSubscribe`: a página ativa desta instância só é tocada por ela
  // (`editIdleLists` pula página ativa de outra) — evento que caiu numa queda
  // do canal (ou que chegou a outro canal físico da mesma chave enquanto este
  // entrava) chegaria a ela só no próximo evento que pedisse refetch.
  const schedule = {
    quietMs: LIST_QUIET_MS,
    maxWaitMs: LIST_MAX_WAIT_MS,
    whenHidden: "defer",
    catchUpOnSubscribe: true,
  } as const;

  // Lista primeiro; contagens e cards 2 s depois (stagger) e só com 60 s de
  // idade. Lista desligada sai do alvo — o canal fica pelas contagens.
  useRealtimeSubscription(
    "leads",
    listEnabled ? [listKey, countsTarget, statsTarget] : [countsTarget, statsTarget],
    { ...schedule, onEvent, enabled },
  );
  // Só a Café Jurerê: a gaveta dela é calculada a partir das entradas de funil.
  // Entrada mudou → a gaveta pode ter mudado em qualquer página: refaz a da
  // tela e marca as ociosas, como um `refetch` de `leads`.
  useRealtimeSubscription(
    "pipeline_entries",
    listEnabled ? [listKey, countsTarget, statsTarget] : [countsTarget, statsTarget],
    {
      ...schedule,
      onEvent: () => {
        markIdleListsStale();
        return "invalidate";
      },
      enabled: enabled && mode === "cafe",
    },
  );
}
