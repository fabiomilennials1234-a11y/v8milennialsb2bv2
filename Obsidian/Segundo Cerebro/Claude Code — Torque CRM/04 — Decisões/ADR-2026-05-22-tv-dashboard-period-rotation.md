---
tags: [adr, dashboard, tv]
date: 2026-05-22
status: accepted
---

# ADR — TV Dashboard com Período Rotativo Global

**Status:** Accepted
**Data:** 2026-05-22
**Decisor:** CTO (Gabriel)

## Contexto

TV Dashboard original mostrava só métricas do mês corrente. Time pediu visão por janelas: **hoje, últimos 7 dias, últimas 2 semanas, mês atual**. Necessidade de ver performance recente sem perder visão mensal.

Bug paralelo descoberto: funil contava "Reuniões Marcadas" filtrando `meeting_date`, escondendo reuniões marcadas neste mês com data futura.

## Decisão

### 1. Período rotativo único global

Estado de período compartilhado via React Context (`TVPeriodProvider`). Cicla automaticamente a cada **12 segundos**:

```
hoje → 7d → 2sem → mes → hoje
```

Todos os blocos consomem `useTVPeriod()` e re-renderizam quando o ciclo troca.

### 2. Nunca "últimos 30 dias" — sempre mês civil

`mes` = **dia 1 do mês corrente até agora**. Rolling 30d explicitamente proibido. Razão: relatórios contábeis/comerciais usam mês civil, não janelas rolantes; alinhamento com meta mensal.

### 3. Termômetro Meta NÃO rotaciona

Meta é mensal. Termômetro mostra sempre o mês corrente, independente do período ativo nos demais blocos.

### 4. Filtro temporal por semântica

Cada métrica usa coluna apropriada ao evento que mede:

| Evento | Coluna |
|---|---|
| Reunião marcada | `metrics_period_at ?? created_at` |
| Compareceu / no-show | `meeting_date` |
| Proposta enviada | `metrics_period_at ?? created_at` |
| Venda fechada | `closed_at` (ADR 2026-04-24) |
| Novo lead | `created_at` |

### 5. Slot Coach/Ranking rotativo

Componente `RotatingSlot` alterna entre painéis a cada ciclo do período. Economiza espaço sem perder ambas as visões.

### 6. Sem pause em hover, sem botão manual

TV é display, não é interativo. Ciclo puro. Simplicidade > controle.

## Consequências

### Positivas
- Time vê quatro janelas temporais sem trocar de tela
- Bug funil resolvido com split semântico
- Layout mais denso de informação útil
- Métricas SDR (dia/total) + closer detalhado (reun/prop/vendas/$/ticket/conv) cobertos

### Negativas
- Mais complexidade no estado da TV (Context + auto-cycle)
- Re-renders a cada troca (200ms tick + 12s cycle); mitigado com `useMemo` nos hooks pesados
- KPIs como "Leads para Trabalhar" (estado atual) não fazem sentido por período — mantidos como estado atual independente

## Alternativas consideradas

- **Por bloco com período independente**: rejeitada — visualmente caótico, viewer não acompanha
- **Manual com botões**: rejeitada — TV ninguém interage
- **Rolling 30d em vez de mês civil**: rejeitada explicitamente pelo CTO

## Implementação

- `src/lib/tv-periods.ts` — helpers + tipos
- `src/contexts/TVPeriodContext.tsx` — provider + hook + cycle
- `src/components/tv/PeriodPill.tsx` — indicador UI
- `src/components/tv/RotatingSlot.tsx` — slot Coach/Ranking
- `src/hooks/useSDRPerformance.ts`
- `src/hooks/useCloserPerformance.ts`
- `src/hooks/useNewLeads.ts`
- `src/hooks/useTVKPIs.ts`
- Fix funil em `src/hooks/useTVDashboardData.ts` (split `confirmacoesMarcadasNoMes` × `currentMonthConfirmacoes`)

Testes: 45 testes unitários (`tests/unit/tv-periods.test.ts`, `useSDRPerformance`, `useCloserPerformance`, `useNewLeads`, `useTVDashboardData-funnel` para regressão).

## Referências

- Spec: `.specs/features/tv-dashboard-v2/spec.md`
- Doc feature: [[../06 — Features/Dashboard/TV Dashboard]]
