---
type: changelog
title: 2026-07-02 — Comando v2 — filtro de período local na aba Saúde
status: shipped
created: 2026-07-02
updated: 2026-07-02
tags: [analytics, comando, saude, funnel-health, filtro-periodo]
related: ["[[Multi-tenancy]]", "[[RPCs]]"]
owner: gabriel
---

# 2026-07-02 — Comando v2 — filtro de período local na aba Saúde

## Contexto

A aba **Saúde** do Comando v2 herdava o período global do `CommandHeader` (prop `range`). O CTO pediu filtro de data **próprio da aba**: segmented **Hoje | Essa semana | Esse mês | Personalizado**, onde Personalizado abre um date range picker — mesmo padrão do `MetricsPeriodSelector` dos funis.

## Mudanças

- **`SaudePeriodFilter.tsx`** (novo, `src/modules/analytics/components/dashboard/`): segmented Tabs h-9 + Popover com `Calendar mode="range" numberOfMonths={2} locale={ptBR}` quando Personalizado ativo. Trigger com label "dd MMM — dd MMM yyyy" / "Selecionar intervalo", mesmo idioma visual do `MetricsPeriodSelector` (border-border/50, bg-secondary/30).
- **`computeSaudePeriodRange(preset, customRange, now?)`** (novo, `src/modules/analytics/lib/saude-period.ts`): cálculo puro do range. `today` = dia corrente UTC; `week` = semana ISO seg→dom (mesma definição do `computePeriodRange` do Comando — NÃO a semana seg–sex do funil); `month` = mês calendário corrente UTC; `custom` = from 00:00 UTC → to 23:59:59.999 UTC, retorna `null` enquanto incompleto (caller mantém último range válido, sem query com intervalo aberto).
- **`utc-day.ts`** (novo, `src/modules/analytics/lib/`): `startOfUTCDay`/`endOfUTCDay` extraídos do `useCommandMetrics` — fonte única da semântica de fronteira de dia UTC do Comando.
- **`TabSaude.tsx`**: gerencia estado local (`preset` default `"month"` + `customRange`); prop `range` removida. Filtro de período ao lado do `SaudeOriginFilter`, mesma linha. Range incompleto no Personalizado mantém os dados anteriores via ref.
- **`Dashboard.tsx`**: `<TabSaude />` sem prop — **mudar o período global no CommandHeader NÃO afeta mais a Saúde**. As demais abas seguem no período global.

## Por quê

Saúde é coorte por criação de lead — gestor analisa recortes diferentes do resto do Comando (ex.: safra da semana vs. mês de vendas). Filtro local desacopla sem tocar backend: `get_funnel_health` já aceita range arbitrário e a queryKey do `useFunnelHealth` já inclui start/end ISO (invalidação automática).

## Arquivos tocados

- `src/modules/analytics/components/dashboard/SaudePeriodFilter.tsx` — novo componente
- `src/modules/analytics/lib/saude-period.ts` — novo, cálculo puro do range
- `src/modules/analytics/lib/utc-day.ts` — novo, helpers UTC extraídos
- `src/modules/analytics/components/dashboard/TabSaude.tsx` — estado local + header
- `src/modules/analytics/hooks/useCommandMetrics.ts` — importa helpers de `utc-day.ts`
- `src/modules/analytics/pages/Dashboard.tsx` — remoção da prop `range` da TabSaude
- `tests/unit/saude-period.test.ts` — 14 testes do cálculo de range

## Follow-ups

- Nota de feature dedicada da Saúde do Funil em `06 — Features/Dashboard/` ainda não existe (semântica vive em `CONTEXT.md`) — criar quando a feature estabilizar.
