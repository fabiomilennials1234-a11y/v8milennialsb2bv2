---
type: changelog
title: 2026-07-14 — Comando v2 — filtro de data único + Personalizado global
status: shipped
created: 2026-07-14
updated: 2026-07-14
tags: [analytics, comando, saude, funnel-health, filtro-periodo, custom-range, ux]
related: ["[[2026-07-02-saude-period-filter]]"]
owner: gabriel
---

# 2026-07-14 — Comando v2 — filtro de data único + Personalizado global

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

## Promoção do "Personalizado" ao filtro global (parte 2, mesmo dia)

A consolidação (parte 1) removeu o `SaudePeriodFilter` local, e com ele o range **"Personalizado"**. Em vez de aceitar essa perda como trade-off, o CTO decidiu **promover o Personalizado ao filtro global** — o intervalo livre agora vive no `CommandPeriod`/`CommandHeader` e serve todas as abas range-driven de uma vez.

- **`useCommandMetrics.ts`**: `CommandPeriod` += `"custom"`. Novo tipo `CommandCustomRange { from: Date; to?: Date }` (mesma forma do `DateRange` do react-day-picker — `to` indefinido enquanto o usuário só clicou a data inicial). `computePeriodRange` ganha 4º param opcional `customRange`. Branch `custom`: `start = startOfUTCDay(from)`, `end = endOfUTCDay(to)`; **janela anterior de mesma duração** terminando no dia anterior ao start (pros deltas); `daysTotal` = dias do intervalo; `dayOfPeriod` = dias decorridos até hoje clampado a `[1, daysTotal]` (range no passado → `daysTotal`, no futuro → `1`); `prevLabel = "período anterior"`.
- **Contrato non-null preservado**: `custom` com range incompleto (só `from`) ou ausente **cai pro mês corrente** em vez de retornar `null` — os callers derreferenciam `range.start` sem guard, então nunca pode ser nulo.
- **`CommandHeader.tsx`**: 5º preset "Personalizado" no segmented. Quando ativo, renderiza `Popover` + `Calendar mode="range" numberOfMonths={2}` (mesmo padrão do `SaudePeriodFilter` deletado), aceitando estado intermediário (só `from`) sem quebrar. Setas de navegação de mês continuam só no preset `month`.
- **`Dashboard.tsx`**: novo state `customRange`, threadado pro header; `range = computePeriodRange(period, month, year, customRange)`; subtitle branch pra custom (`de dd/MM a dd/MM`, ou "Selecione um intervalo" enquanto incompleto).

**Visão Geral e Saúde herdam o custom de graça** — ambas já consomem o `range` global, sem nenhuma mudança nelas. **Performance segue mensal por design** (ranking/metas são do mês; `computePeriodRange("month", …)` hardcoded, intocado). **TV é subsistema à parte** (`TVPeriod` próprio), intocado. Resultado: um único filtro de data no Comando, agora com intervalo livre, sem reintroduzir controle local.

## Arquivos tocados

**Parte 1 — consolidação:**
- `src/modules/analytics/pages/Dashboard.tsx` — passa `range` para `TabSaude`
- `src/modules/analytics/components/dashboard/TabSaude.tsx` — consome `range` global; estado local de período removido
- `src/modules/analytics/lib/utc-day.ts` — comentário atualizado (removida menção ao `saude-period` deletado)
- `src/modules/analytics/components/dashboard/SaudePeriodFilter.tsx` — **deletado**
- `src/modules/analytics/lib/saude-period.ts` — **deletado**
- `tests/unit/saude-period.test.ts` — **deletado**
- `tests/unit/utc-day.test.ts` — novo (cobertura dos helpers UTC extraída antes da deleção)

**Parte 2 — Personalizado global:**
- `src/modules/analytics/hooks/useCommandMetrics.ts` — `CommandPeriod` += `"custom"`; novo tipo `CommandCustomRange`; `computePeriodRange` ganha 4º param `customRange` + branch custom com prev de mesma duração e fallback non-null pro mês
- `src/modules/analytics/pages/Dashboard.tsx` — state `customRange` + threading pro header; subtitle branch custom; `PERIOD_LABEL` += `custom`
- `src/modules/analytics/components/dashboard/v2/CommandHeader.tsx` — 5º preset "Personalizado" + `Popover`/`Calendar mode="range"` de 2 meses; novos props `customRange`/`onCustomRangeChange`
- `tests/unit/command-period-custom.test.ts` — novo (fronteiras UTC, prev de mesma duração, dayOfPeriod passado/corrente/futuro, fallback non-null)

## Follow-ups

- ✅ **Range custom no filtro global** — feito na parte 2 (acima). Intervalo arbitrário promovido pro `CommandPeriod`/`CommandHeader`; Visão Geral + Saúde herdam. Performance segue mensal por design (decisão de produto separada). TV intocado.
- **dep-cruiser baseline**: `lint:deps:check` está vermelho por 4 violações `no-circular` pré-existentes em `leads`/`engagement`/`platform`, presentes em `origin/main` e sem relação com esta mudança. Baseline **não** foi regenerada de propósito — regenerar assimilaria essas 4 violações não-justificadas (o próprio ratchet alerta contra). As 15 entradas stale dos arquivos deletados permanecem no baseline mas são inócuas (o ratchet só falha em violações NOVAS, ignora removidas). Endereçar os 4 ciclos em tarefa separada.
