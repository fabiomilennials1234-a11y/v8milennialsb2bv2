---
type: changelog
title: Leads — agendador de invalidações realtime e contagem com teto
status: active
created: 2026-10-05
updated: 2026-10-06
tags: [changelog, leads, performance, realtime]
related: []
owner: claude-agent
---

# 2026-10-05 — Leads: agendador de invalidações realtime e contagem com teto

## Mudanças
- **Realtime / agendador** (`src/shared/realtime/invalidation-scheduler.ts`, novo): um por QueryClient. Decide, no disparo, se cada query do alvo ainda precisa refazer — frescor por query (o RESULTADO em cache veio de um fetch que começou depois do evento), fetch em voo espera o QueryCache avisar o fim e decide de novo na hora (sem cancelar, sem relógio de re-tentativa), toda invalidação sai com `refetchType: "active"` + `cancelRefetch: false`. Duas instâncias no mesmo alvo e evento = uma invalidação. Só ouve o QueryCache enquanto há hook montado ou pedido pendente.
- **`useRealtimeSubscription`**: aceita alvo composto aninhado (`[ ["pipeline_entries", slug, org] ]`), alvo com idade mínima (`{ queryKey, minAgeMs }`), classificador `onEvent` (`"skip" | "invalidate" | { invalidate }`), `enabled`, e os opt-ins `quietMs`, `maxWaitMs`, `whenHidden: "defer"`. **Sem opt-in, a sequência de hoje**: debounce 2 s, stagger 2 s, aba oculta refaz. Filtro `organization_id=eq.<org>` e `TABLES_WITHOUT_ORG_ID` intocados; `useRealtimeChannel` não mudou.
- **Leads / realtime** (`useLeadsRealtime`, novo): `useLeads` assinava 4 tabelas (`leads`, `deals` — que nem está publicada —, `pipeline_entries`, `sale_events`); agora 1 canal em `leads` (+ `pipeline_entries` só no piloto Café Jurerê). Cada evento passa por `classifyLeadEvent` (`lib/lead-realtime-relevance.ts`, novo): patch local (lead na tela, só coluna fora de recorte), só contagens (lead fora da tela, depois da última linha), ou tudo. Lista: 30 s de silêncio com teto de 30 s; contagens/cards: só com 60 s de idade; aba oculta guarda e dispara ao voltar.
- **Leads / contagem com teto** (`lib/capped-count.ts`, novo): total, 4 abas e 2 cards deixam de ser `count: "exact"` — `select("id")` + filtros + `.limit(1000)`, sem `order`. A tela diz "1.000+"; paginação segue além da página 20 enquanto a página vem cheia; "última página" some no teto; `LeadsStatsV2` não deriva nada por subtração de valor com teto (percentual some; "sem responsável" vira `N+` ou "—").
- **Leads / chaves** (`lib/leads-query-keys.ts`, novo): `["leads","list",org,…]`, `["leads","count",org,…]`, `["leads","stats",org,tz,…]`. Mutação que invalida `["leads"]` agora também atualiza contagens e cards.
- **Leads / Relação**: a consulta extra de relação por página saiu — `relacao_negocios` é coluna e vem no `*`. Só a Café Jurerê (campo calculado) mantém a consulta estreita.
- **Compostos planos corrigidos** (invalidavam o domínio inteiro + chaves que não casam com nada): `usePipelineEntries`, `useCustomPipeEntries` (mesma constante da query), `usePipelineStages`, `useCarteiraStages`, `useActivities`, `useCopilotPause`, `usePaginatedPipeline` (org na posição 3 — alvo `["pipeline-page", slug]`).
- **Regra ESLint** (`eslint.config.js`): `no-restricted-syntax` barra composto plano e chave solta em variável no 2º argumento de `useRealtimeSubscription`, nos DOIS blocos (no flat config, o bloco posterior substitui a lista).
- **Copilot**: `useCopilotToggleRealtime` deixa de invalidar `["leads"]` a cada evento de `phone_ai_preferences` (1.015 updates contra 178 de `leads` desde o restart) — nenhum consumidor de `useLeads` lê `ai_disabled`.
- **Analytics**: `useDashboardMetrics` e `useCommandMetrics` fazem opt-in de `whenHidden: "defer"` + `maxWaitMs: 30_000`.
- `useRegisterHistoricalSales`: sai a chave morta `"leads-count"`.

## Volta 1 — correções da revisão (CP-v4)
- **B1 (bloqueante) — patch apagado por fetch em voo**: o fetch da lista que tirou o retrato antes do UPDATE chegava depois e sobrescrevia o patch; como o classificador devolvia `"skip"`, a linha ficava velha por até 5 min. Agora `useLeadsRealtime`: patch com a página da tela buscando aplica o patch E pede `{ invalidate: [listKey] }` (refaz depois desse fetch, no prazo da lista); página ociosa buscando vai por `invalidateOnceSettled` (marcada só quando o fetch dela termina — o `success` do TanStack zera `isInvalidated`).
- **M1 — frescor gravado no início do fetch**: o número de sequência do fetch só vira frescor no `success` não-manual. Não contam: `fetchNextPage`/`fetchPreviousPage` (`meta.fetchMore`), fetch que falha, cancelamento com `revert`, `setQueryData`.
- **Re-arma por evento**: alvo buscando no disparo esperava `quietMs` (30 s em Leads) e tentava de novo; agora espera o QueryCache avisar `fetchStatus: "idle"` (sucesso, erro, revert, reset) ou `removed`, e decide no instante seguinte. Ciclo de vida: `retainInvalidationScheduler` (layout effect do hook) + pedidos pendentes; sem nenhum, a inscrição no cache sai.
- **Aba Clientes**: lista desligada (`portfolioActive`) não desliga mais o canal de `leads` — as contagens das abas e os cards continuam recebendo o evento (com o `minAgeMs` de 60 s). Só o alvo da lista depende de `enabled`. Página desligada conta como ociosa (`!query.isActive()`) para ser marcada velha.
- **Toggle de IA**: `useCopilotToggleMutation.onSettled` não invalida mais `["leads"]` (refazia lista + 4 contagens + 2 cards por toggle) e `useToggleLeadAI.onMutate` não cancela mais `["leads"]` (jogava fora contagem em voo). Prova: nenhum consumidor de `useLeads` lê `ai_disabled`.
- **ESLint**: a regra também pega composto plano com raiz em acesso a membro ou chamada (`[keys.root, slug]`, `[rootOf(x), org]`); aceita `QUERY_KEYS.PIPELINE` como seguidor. Custo conhecido: lista de chaves inteiras vindas de fábrica (`[keys.list(org), outra]`) acusa — ponha cada uma numa variável.
- Paginação com teto virou função pura compartilhada (`cappedPagination`, `knownTotalLabel` em `lib/capped-count.ts`), usada pelas duas interfaces.

## Volta 2 — páginas em cache que a tela não mostra (CP-v6, 2026-10-06)
Raiz única do B2 (revisor) e do 1g/1h (QA): o patch fazia `setQueriesData` em TODA página sob `["leads","list",org]`. Todo `setQueryData` é um `success` do TanStack — zera `isInvalidated` e renova `dataUpdatedAt` mesmo devolvendo as mesmas linhas.
- **B2**: página ociosa marcada como velha (INSERT, `invalidateOnceSettled`) perdia a marca no primeiro patch de qualquer lead; sob tráfego nunca vencia o staleTime e voltar a ela não buscava.
- **1g/1h**: com duas listas ativas (tela + picker), a 1ª instância patchava a da 2ª que estava buscando; o classificador da 2ª via a linha já patchada → `ignore` → o fetch em voo devolvia o retrato de antes para sempre. O ramo `remove` tinha o mesmo defeito (a 2ª via o id fora do cache → `ignore`; página com 49 linhas ou com o lead apagado de volta).
- **Conserto** (`useLeadsRealtime.ts`, `editIdleLists`, usado por `patch` e `remove`): página a página, nunca às cegas. Ativa de outra instância → não mexe (o dono recebe o mesmo evento e decide com a página dele; toda página ativa tem dono porque a única chave de lista é a de `useLeads`, que liga query e hook com a mesma chave e o mesmo `enabled`). Buscando → não mexe (o refetch depois vem do agendador, para a própria, ou de `settleIdleInFlight`, para as ociosas). Sem o lead → nenhum dispatch. Parada com o lead → edita preservando `updatedAt` e re-marca se estava velha.
- **Linha da tela buscando**: não recebe mais o patch — fica no valor de antes até o refetch (≤ 30 s de silêncio + o fetch), em vez de piscar novo → antigo → novo.
- **Café Jurerê**: o canal de `pipeline_entries` ganhou `onEvent` que marca as páginas ociosas (antes só refazia a da tela).
- Testes novos no harness (V5 e clássica): B2 sem o lead (sem dispatch), (i) com o lead marcada e sem marca (idade preservada vence o staleTime no prazo de antes), (ii) ociosa buscando, sem piscar, duas listas ativas com DELETE (parada e buscando), Café. `qa-leads-adversarial` virou teste definitivo (sem `QA_IMPL`/`QA_OLD_DIR`/`QA_LOG`); `3b` segue `describe.skip` (pré-existente, follow-up).
- Controle positivo (cópia scratch, um mutante por vez): hook da volta 1 → 10 vermelhos na V5 e 10 na clássica; `markIdleListsStale` sem invalidar, `settleIdleInFlight` vazio, `refetch` sem marcar, despachar sem o lead, renovar idade, não re-marcar, editar ativa de outro, editar em voo, Café sem `onEvent`, patch nunca pedir refetch → cada um deixa ≥ 1 teste vermelho.

## Volta 3 — o evento não chega a quem decide (CP-v8, 2026-10-06)
Dois furos achados pelo QA (repro determinístico), autorizados pelo CTO para corrigir antes do PR.
- **F — veredito decidido contra a página em cache com a da tela buscando.** `counts` ("o lead está depois da última linha, a página não muda") olhava a página em cache; com a página da tela em voo, a página a caminho é outra (ex.: um lead saiu do filtro e o 51º entrou) — coluna velha ou lead que entra no vão nunca apareciam (30,5 min, 0 busca). DELETE de id fora de todo cache com a página em voo deixava fantasma pelo mesmo motivo. Conserto (`useLeadsRealtime.ts`, `ownListInFlight`): nesses dois vereditos, página da tela buscando → pede também a lista, que o agendador refaz DEPOIS desse fetch (espelho do que o `patch` já fazia).
- **B — o dono da página ativa não recebeu o evento.** Cada instância de `useLeads` tem o próprio canal, com join independente; evento entregue às irmãs enquanto o canal de uma está "joining" não chega a ela, e ninguém mais toca a página ativa dela (`editIdleLists` pula ativa de outra, de propósito). Lista velha / lead apagado visível até o próximo evento que pedisse refetch (B1/B3/B4/B5b). Numa queda (`CHANNEL_ERROR`/`TIMED_OUT`/circuito), o evento cai para todas (B2/B6b de transporte).
- **Conserto B** — opt-in genérico `catchUpOnSubscribe` em `useRealtimeSubscription` (padrão desligado: os outros ~50 callers não mudam):
  - o agendador anota, por canal lógico (tabela + filtro), a sequência da última entrega a QUALQUER instância (`recordRealtimeDelivery`/`lastRealtimeDelivery` em `invalidation-scheduler.ts`; vive e morre com o agendador);
  - 1º SUBSCRIBED do canal (montagem, troca de org): se alguma entrega aconteceu depois que este canal começou a entrar, agenda todos os alvos como um evento comum com a sequência dessa entrega — o agendador só refaz query cujo retrato é mais velho que ela (fetch em voo é esperado, nunca cancelado; `minAgeMs`, stagger e `whenHidden` valem). Ninguém recebeu nada: 0 consulta;
  - SUBSCRIBED de novo depois de cair: agenda os alvos uma vez, sempre. Custo: 1 busca da lista por reconexão (+ contagens que já tenham 60 s).
  - Fonte do estado: o `state` que `useRealtimeChannel` já devolve (`joined` só depois do SUBSCRIBED). `useRealtimeChannel.ts`, `useRealtimeChannelStatus.ts` e `realtimeStatusStore.ts` NÃO foram tocados (a troca por Broadcast está sendo desenhada noutra sessão nesses arquivos).
  - O `joined` lido no render em que o canal troca (org nova) ainda é do canal velho: ignorado — sem isso a troca de org contaria como queda (1 busca a mais).
  - Ligado nos dois canais de `useLeadsRealtime` (`leads` e o `pipeline_entries` da Café).
- **Cobertura** que faltava (revisor): `remove` e `counts` marcando a página ociosa que não tem o lead (`leads-realtime-harness`, V5 e clássica).
- **Testes permanentes**: `tests/unit/leads-realtime-convergencia.test.tsx` (+ cópia em `tests/classic/`) com transporte dublado que reporta `joining` até o SUBSCRIBED e passa por `errored` na queda: F1, F2, DELETE em voo, B1, B2, B3, B4, B5b, D1, caso normal (1 e 3 listas, evento antes da montagem, troca de org: 0 consulta extra), queda e volta (exatamente 1 busca da lista; evento que caiu para todas aparece) e carga (rajada 7, 5 min a 1/3 s 39, três instâncias 9 — iguais à volta 2). `useRealtimeSubscription-refactored`: bloco do opt-in (padrão não reage a SUBSCRIBED; 1º join com e sem entrega; entrega de outra tabela; queda por erro/circuito; canal desligado).
- **Controle positivo** (cópia scratch, nunca o worktree): os testes novos contra o código da volta 2 → 11 vermelhos (F1, F2, DELETE, B1–B5b, 3 de queda); mutantes do conserto (`counts`/DELETE sem lista, sem opt-in, 1º join sempre refaz, sem o `since`, sem recuperar na volta, sem recuperar no 1º join, `joined` do canal velho contando, sem anotar entrega, R-c, R-d) → cada um com ≥ 1 vermelho.

## Interface clássica (port no mesmo PR)
113 de 120 orgs (53.630 de 74.566 leads) estão na clássica (`ui_v5_enabled = false`); sem o port o incidente seguia para a maioria. Mecanismo do #2241: editar `classic/` → `node scripts/ui-classic/snapshot.mjs --gerar-patch`. `classic/SNAPSHOT.json` intocado; a clássica NÃO foi regenerada da main.
- **Cópia byte a byte de `src/`** (o arquivo da clássica era idêntico ao `src/` de antes): `shared/realtime/{useRealtimeSubscription,invalidation-scheduler}.ts`, `leads/hooks/{useLeads,useLeadsStats,useLeadsRealtime,useRegisterHistoricalSales}.ts`, `leads/lib/{capped-count,leads-query-keys,lead-realtime-relevance}.ts`, `copilot/hooks/{useCopilotToggle,useCopilotToggleRealtime,useCopilotPause}.ts`, `analytics/hooks/{useCommandMetrics,useDashboardMetrics}.ts`, `carteira/hooks/useCarteiraStages.ts`, `engagement/hooks/useActivities.ts`, `pipelines/hooks/model/{usePaginatedPipeline,usePipelineEntries,usePipelineStages}.ts`.
- **Só o hunk deste PR**: `pipelines/hooks/custom/useCustomPipelines.ts` (a clássica já divergia pelas 3 invalidações do #2230 — lacuna anterior, declarada no #2241).
- **Adaptados, visual pré-V5 mantido**: `leads/pages/Leads.tsx` (contagens das abas e cards com `formatCappedCount`; "1.000+ leads · página N" no teto; rodapé Anterior/Próxima com `cappedPagination` — "Página N (1.000+ leads)" no teto, "Página X de Y (1.234 leads)" exato, agora com separador pt-BR; volta uma página se a do teto vier vazia) e `leads/components/leads/LeadsStatsV2.tsx` (três cards da clássica: "1.000+", sem percentual nem barra com total no teto, "N+ sem dono" / "sem dono: recorte grande demais para contar").
- Não portado: `LeadsPageSegments.tsx` (paginação segmentada é visual V5); regra ESLint (a clássica é fora de ESLint e tsc).
- Testes: `tests/classic/{useRealtimeSubscription-refactored,leads-realtime-harness,lead-realtime-relevance,leads-stats-org-scope,leads-stats-mesmos-filtros}.test.*` (cópias) + `tests/classic/leads-capped-count-ui.test.tsx` (cards da clássica). Controle positivo: os 6 arquivos contra a clássica antiga ficam vermelhos (harness: 13 de 14).
- Patch: ida e volta conferida — pristina `f9a29504` + `classic.patch` == `classic/` (src, index.html, tailwind.config.ts), `git apply --check` limpo.

## Por quê
- Prod 2026-10-05: a tela de Leads era 60% do tempo do banco. Cada aba refazia lista + 6 `count: exact` a cada evento realtime da org; ~40 usuários saturavam 2 vCPU. `statement_timeout` de 8 s + `retry: 1` fazia a contagem que estoura rodar duas vezes.

## Números (harness `tests/unit/leads-realtime-harness.test.tsx`, mesmos hooks e parâmetros de `Leads.tsx`)

| Cenário | antes | depois |
|---|---|---|
| Rajada de 20 eventos em 10 s | 6 fetches da lista + contagens | 1 da lista, 0 de contagem |
| 2 min de eventos a cada 3 s | 80 fetches da lista | ≤ 4 da lista; ≤ 1 por contagem a cada 60 s |
| 90 s com a aba oculta | 294 consultas | 0; ao voltar, 1 da lista + 1 por contagem |
| UPDATE de coluna fora de recorte, lead na tela | 2 (lista + relação) | 0 (patch no cache) |
| UPDATE de lead além da página | 1 | 0 da lista |
| DELETE de id desconhecido | 2 | 0 |
| `count: exact` em leads | 6 por refresh | 0 |

## Decisões
- O hook continua dono do QUANDO (debounce/stagger); o agendador decide o SE. Assim os 50 callers sem opt-in (inclusive os hooks do chat, em reescrita noutra sessão) mantêm a sequência temporal — teste de não-regressão passa no código antigo e no novo.
- `minAgeMs` é throttle, não descarte: contagem jovem espera completar a idade e refaz uma vez. Nunca fica velha para sempre.
- Teto da contagem = 1.000, constante única (`LEADS_COUNT_CAP`). Pré-condição: `max-rows` do PostgREST de prod ≥ 1.000 — CONFIRMADO = 1.000 via Management API (`GET /v1/projects/<ref>/postgrest`); `.limit(1000)` é exato no limite.
- Descartados: `count: "estimated"` (número do planejador é ficção com RLS/`ilike`); throttle com disparo imediato; `refetchInterval` nas contagens; avaliar filtro no cliente.

## Riscos e limites conhecidos
- Lead fora da tela cujo `created_at` MUDOU pode deslocar a página sem refetch (o realtime não traz o valor antigo). Raro; corrige no próximo refetch da lista (≤ 30 s) ou ação do usuário.
- Em recorte de exatamente N×50 leads no teto, "Próxima" leva a uma página vazia — a tela volta uma página sozinha.
- Edição de lead agora refaz contagens e cards na hora (chaves aninhadas) — custo por edição humana, a favor da correção.
- Fetch substituído por `invalidateQueries` com `cancelRefetch: true` (padrão do TanStack, usado por mutações) não emite nova action `fetch`: o frescor fica com o início do fetch cancelado — lado conservador (no máximo um refetch a mais), nunca evento perdido.
- Query buscada antes de qualquer hook com realtime montar não tem início registrado: conta como velha (um refetch a mais no primeiro evento).
- ~~Página ativa depende do próprio dono receber o evento~~ — resolvido na volta 3 (`catchUpOnSubscribe`). Sobra: evento que caiu para TODAS durante o 1º join (montagem ou troca de org sem nenhuma irmã já dentro) — mesmo contrato de antes, e o mesmo da montagem de qualquer tela; evento perdido pelo servidor com o canal já `joined`, sem queda (B4b), não tem como ser notado.
- ~~Veredito `counts` com a página da tela buscando~~ — resolvido na volta 3.
- Recuperação no SUBSCRIBED anota entrega de QUALQUER instância (inclusive de DELETE de outra org, que o servidor não filtra) e de evento que chegue a esta mesma instância entre o SUBSCRIBED e o effect que o lê: no pior caso, 1 refetch conservador a mais, só quando há evento no vão do join.
- Depois de uma queda, só os alvos da instância são refeitos; páginas ociosas em cache não são marcadas (voltar a elas dentro do staleTime de 5 min pode mostrar retrato de antes da queda).
- `CLOSED` do canal não muda o estado em `useRealtimeChannel` (nem religa): não há volta para observar. Fora do escopo (transporte).

## Arquivos tocados
- Novos: `src/shared/realtime/invalidation-scheduler.ts`, `src/modules/leads/hooks/useLeadsRealtime.ts`, `src/modules/leads/lib/{lead-realtime-relevance,capped-count,leads-query-keys}.ts`, `src/modules/leads/components/leads/LeadsPageSegments.tsx`.
- Editados: `src/shared/realtime/useRealtimeSubscription.ts`, `src/modules/leads/hooks/{useLeads,useLeadsStats,useRegisterHistoricalSales}.ts`, `src/modules/leads/pages/Leads.tsx`, `src/modules/leads/components/leads/LeadsStatsV2.tsx`, `src/modules/copilot/hooks/{useCopilotToggleRealtime,useCopilotPause}.ts`, `src/modules/pipelines/hooks/model/{usePipelineEntries,usePaginatedPipeline,usePipelineStages}.ts`, `src/modules/pipelines/hooks/custom/useCustomPipelines.ts`, `src/modules/carteira/hooks/useCarteiraStages.ts`, `src/modules/engagement/hooks/useActivities.ts`, `src/modules/analytics/hooks/{useDashboardMetrics,useCommandMetrics}.ts`, `eslint.config.js`.
- Testes: `tests/unit/{useRealtimeSubscription-refactored,leads-realtime-harness,lead-realtime-relevance,leads-capped-count-ui,eslint-realtime-composite-keys,leads-stats-mesmos-filtros,leads-stats-org-scope,hooks-sprint2-leads}.test.*`.
- Volta 1: `src/modules/copilot/hooks/useCopilotToggle.ts`, `src/modules/leads/hooks/useLeads.ts` (`useToggleLeadAI`).
- Volta 2: `src/modules/leads/hooks/useLeadsRealtime.ts` (+ gêmeo da clássica, byte a byte), `tests/unit/leads-realtime-harness.test.tsx`, `tests/unit/qa-leads-adversarial.test.tsx` (+ cópias em `tests/classic/`), `scripts/ui-classic/classic.patch`.
- Volta 3: `src/modules/leads/hooks/useLeadsRealtime.ts`, `src/shared/realtime/{useRealtimeSubscription,invalidation-scheduler}.ts` (+ gêmeos da clássica, byte a byte), `tests/unit/{leads-realtime-convergencia,leads-realtime-harness,useRealtimeSubscription-refactored}.test.*` (+ cópias em `tests/classic/`), `scripts/ui-classic/classic.patch`.
- Clássica: os gêmeos em `classic/src/` (lista acima), `scripts/ui-classic/classic.patch`, `tests/classic/*` (6 arquivos), `docs/ui-v5/interface-por-organizacao.md`.

## Follow-ups
- Deep-link `?atribuicao=sem-responsavel`: cards dão "333%"/"0 sem responsável" (V5) e "0 sem dono" (clássica) — pré-existente; destravar o `describe.skip("3b …")` de `qa-leads-adversarial` junto do conserto.
- Subir `LEADS_COUNT_CAP` quando a RLS de leads reescrita entrar (e o `max-rows` junto).
- `useToggleLeadAI`: o otimista e o rollback em `["leads", organizationId]` escrevem numa chave que não existe (a lista é `["leads","list",org,…]`) — código morto, inofensivo; remover junto com a revisão do Copilot.
- Herdados vermelhos na main (não deste PR): `tests/unit/hooks-sprint2-leads.test.ts` (`useDeleteLead`, 1), `tests/unit/lead-origins-ui.test.tsx` (3, `useAuth` fora do provider) e `tests/unit/useChatBubbleContactsRealtime.test.ts` (4, idênticos na base `f884118f9`).
- Transporte (com a troca por Broadcast): recuperar também no 1º join quando nenhuma irmã estava dentro (B6b) e tratar `CLOSED`.
- `usePipelineEntries.ts:19-23`: `onUpdate` espalha timestamp cru do realtime (formato que o Safari não lê).
- `useClientPortfolio.ts:38` assina `deals` (não publicada; no-op).
- Card "sem responsável" conta `responsible_id`, mas o clique filtra dono em 3 colunas.
- `useCopilotToggleRealtime` ainda invalida `["lead-detail"]`/`["pipeline_entries"]` amplo a cada evento.
- `usePaginatedPipeline` não é chamado em lugar nenhum; `leads-deals`/`leads-sales-metrics` sem invalidação realtime; retry em `57014`.
