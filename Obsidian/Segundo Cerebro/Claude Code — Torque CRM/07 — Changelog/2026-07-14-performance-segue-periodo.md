---
type: changelog
title: 2026-07-14 — Comando v2 — aba Performance segue o período global
status: shipped
created: 2026-07-14
updated: 2026-07-14
tags: [analytics, comando, performance, filtro-periodo, ranking, metas, ux]
related: ["[[2026-07-14-saude-filtro-data-unico]]"]
owner: gabriel
---

# 2026-07-14 — Comando v2 — aba Performance segue o período global

## Contexto

Depois de consolidar o filtro de data no período global do Comando (incl. "Personalizado"), a aba **Performance** ainda ignorava o período: hardcodava `computePeriodRange("month", month, year)` — mostrava sempre o mês, mesmo com Semana/Trimestre/Personalizado selecionado. O CTO pediu que Performance também reagisse ao período.

## Mudança

As peças **period-scoped** da Performance passam a seguir o `range` global; as **metas** ficam mensais (são mensais por natureza — a tabela `goals` é chaveada por `month`/`year`).

**Seguem o período (range global):**
- Vendas totais, clientes, reuniões (`useCommandMetrics(range)`)
- Pódio de ranking (`RankingPodium`), Produtos campeões (`ProductChampions`), Atividade da equipe (`TeamActivityCard`)
- Jornada do lead (`LeadJourney`), Motivos de perda (`LossReasonsCard`)

**Permanecem mensais (com label "· mês"):**
- Gauges de metas da equipe (`TeamGoalsGauges`) — `current` mensal (`gaugeMetrics` de um `monthRange` separado) vs meta mensal; `expectedPercent` = pacing do mês
- Metas individuais (`IndividualGoalsList`)
- Real vs Esperado (`RealVsExpectedChart`) — acumulado do mês vs linha da meta

É o mesmo padrão que a aba **Visão Geral** já usava pro gauge dela (range global pros KPIs + `monthRange` separado pra meta).

### Backward-compat dos hooks compartilhados

`useRankingData`, `useProductRanking` e `useSellerActivity` ganharam um 3º param **opcional** de range (`rangeOverride`). Ausente → comportamento month/year idêntico ao anterior. Os demais consumidores (`Performance.tsx`, `TVDashboard`, `RankingTable`, `TopPerformers`, `ProductRanking`, `SellerActivityCard`) chamam sem o override — intocados.

## Limitação conhecida (decisão do CTO — shippar assim)

O **pódio de ranking de vendas** só reage ao período de fato quando a flag `canonical_metrics` estiver ligada. Motivo: `useRankingData` roda a RPC legada **`get_ranking_data(p_month, p_year, org)`**, travada no mês; só o overlay canônico **`get_ranking(...p_start, p_end...)`** é range-aware, e ele está em dark-launch (refundação de métricas — PRD #986, ainda não live em prod). O pódio de **reuniões** é sempre mensal (legado).

- Com `canonical_metrics` **OFF** (estado atual): o pódio fica mensal (label honesto "Ranking do mês"), enquanto o resto da aba segue o período. Inconsistência aceita conscientemente.
- Quando a flag virar (direção já planejada pela refundação), o pódio passa a seguir o período **sem mudança de frontend** — o front já manda o range.

**Fast-follow opcional** (se o pódio precisar reagir antes da flag): tornar `get_ranking_data` range-aware com `p_start`/`p_end` opcionais e aditivos (backward-compat com os testes de integração `sdr-merito` e `snapshot-lifecycle`) + deploy. Fora do escopo deste PR (backend, área frágil).

## Arquivos tocados

- `src/modules/analytics/components/dashboard/v2/TabPerformanceV2.tsx` — recebe `range`; fontes period vs mensal reconfiguradas
- `src/modules/analytics/pages/Dashboard.tsx` — passa `range` pro TabPerformanceV2
- `RankingPodium.tsx` / `ProductChampions.tsx` / `TeamActivityCard.tsx` — props `{month,year}` → `{range}`
- `TeamGoalsGauges.tsx` / `IndividualGoalsList.tsx` / `RealVsExpectedChart.tsx` — label "· mês"
- `useDashboardMetrics.ts` (`useRankingData`) / `useProductRanking.ts` / `useSellerActivity.ts` — 3º param opcional `rangeOverride`, backward-compat

## QA

- `tsc --noEmit` exit 0; `eslint` limpo (3 warnings `any` pré-existentes, não tocados); **197 testes verdes** em 18 suítes (command/dashboard/ranking/goals/TV), zero regressão.
- Backward-compat confirmado: tsc verde em todos os call-sites dos 3 hooks sem alteração neles.
