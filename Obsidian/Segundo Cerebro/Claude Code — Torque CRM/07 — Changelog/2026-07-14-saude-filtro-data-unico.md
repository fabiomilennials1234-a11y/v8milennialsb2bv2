---
type: changelog
title: 2026-07-14 — Comando v2 — filtro de data único na aba Saúde
status: shipped
created: 2026-07-14
updated: 2026-07-14
tags: [analytics, comando, saude, funnel-health, filtro-periodo, ux]
related: ["[[2026-07-02-saude-period-filter]]"]
owner: gabriel
---

# 2026-07-14 — Comando v2 — filtro de data único na aba Saúde

## Contexto

Print do CTO em prod expôs **dois filtros de data** simultâneos na aba **Saúde** do Comando v2:

1. **Global** — seletor de período do `CommandHeader` (segmented Hoje | Semana | Mês | Trim. + navegação de mês), tipo `CommandPeriod`, que dirige todas as abas.
2. **Local** — o `SaudePeriodFilter` (Hoje | Essa semana | Esse mês | Personalizado) adicionado em 2026-07-02, independente do global.

Dois controles de data na mesma tela = usuário não sabe onde filtrar. Reverte a decisão de 2026-07-02.

## Mudança

Filtro de data da aba Saúde **consolidado no período global do Comando**. A aba passa a consumir o mesmo `range` do `CommandHeader` que as demais abas — mudar o período no header agora move os dados da Saúde junto.

- **`Dashboard.tsx`**: `<TabSaude />` → `<TabSaude range={range} />`. O `range` já vinha computado por `computePeriodRange(period, selectedMonth, selectedYear)` (tipo `PeriodRange` de `useCommandMetrics`).
- **`TabSaude.tsx`**: recebe `range: PeriodRange` por prop e alimenta `useFunnelHealth({ start, end }, origins)` direto. Removido todo o estado local de período (`preset`/`customRange`), o `useMemo` do range, o `lastValidRangeRef` e a renderização do `SaudePeriodFilter`. `periodLabel` agora reflete o range global. **`SaudeOriginFilter` intocado** — filtro de origem é ortogonal ao de data.
- **Removidos**: `SaudePeriodFilter.tsx`, `saude-period.ts` (`computeSaudePeriodRange` + tipos) e `tests/unit/saude-period.test.ts`.
- **`utc-day.ts` preservado** — `startOfUTCDay`/`endOfUTCDay` ainda são a fonte única de fronteira de dia UTC do `useCommandMetrics`. A cobertura desses helpers, que morava dentro de `saude-period.test.ts`, foi extraída para `tests/unit/utc-day.test.ts` (nenhuma perda de teste sobre código sobrevivente).

## Trade-off

Perde-se o range **"Personalizado"** (date range picker de intervalo arbitrário) que só a Saúde tinha. O período global oferece Hoje | Semana | Mês | Trim. + navegação de mês — sem intervalo livre. Aceito: um único filtro de data centralizado > dois filtros conflitantes. Adicionar range custom ao filtro global é follow-up separado, beneficiando todas as abas de uma vez.

## Arquivos tocados

- `src/modules/analytics/pages/Dashboard.tsx` — passa `range` para `TabSaude`
- `src/modules/analytics/components/dashboard/TabSaude.tsx` — consome `range` global; estado local de período removido
- `src/modules/analytics/lib/utc-day.ts` — comentário atualizado (removida menção ao `saude-period` deletado)
- `src/modules/analytics/components/dashboard/SaudePeriodFilter.tsx` — **deletado**
- `src/modules/analytics/lib/saude-period.ts` — **deletado**
- `tests/unit/saude-period.test.ts` — **deletado**
- `tests/unit/utc-day.test.ts` — novo (cobertura dos helpers UTC extraída antes da deleção)

## Follow-ups

- **Range custom no filtro global**: levar o intervalo arbitrário (Personalizado) pro `CommandPeriod`/`CommandHeader`, servindo todas as abas de uma vez. Recupera a capacidade perdida sem reintroduzir filtro local.
- **dep-cruiser baseline**: `lint:deps:check` está vermelho por 4 violações `no-circular` pré-existentes em `leads`/`engagement`/`platform`, presentes em `origin/main` e sem relação com esta mudança. Baseline **não** foi regenerada de propósito — regenerar assimilaria essas 4 violações não-justificadas (o próprio ratchet alerta contra). As 15 entradas stale dos arquivos deletados permanecem no baseline mas são inócuas (o ratchet só falha em violações NOVAS, ignora removidas). Endereçar os 4 ciclos em tarefa separada.
