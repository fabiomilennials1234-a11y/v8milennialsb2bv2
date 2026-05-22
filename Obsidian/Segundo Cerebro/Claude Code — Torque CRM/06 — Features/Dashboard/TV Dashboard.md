---
tags: [feature, dashboard, tv]
created: 2026-05-22
---

# TV Dashboard

Display para parede do time comercial. Métricas em tempo real, otimizado pra ser lido a 2-3 metros.

## Rotas

- **`/tv`** (frontend) → `src/pages/TVDashboard.tsx`

## Período rotativo

Estado global via `TVPeriodProvider` (`src/contexts/TVPeriodContext.tsx`). Cicla automaticamente a cada 12s:

```
hoje → 7d → 2sem → mes (mês civil) → hoje
```

**Nunca usar "últimos 30 dias".** `mes` = dia 1 do mês corrente → agora.

Helpers em [[../../03 — Reference/Schema.md|schema]] e `src/lib/tv-periods.ts`:
- `getPeriodRange(period, now): { start, end }`
- `getDailyBuckets(range)` — para sparklines
- `inRange(date, range)` — filtro temporal genérico

## Layout

```
Header: logo | título | PeriodPill | hora | refresh | fullscreen

Linha 1:
- col-3: Termômetro Meta (SEMPRE mês civil, não rotaciona)
- col-9 (interna):
  - KPI Row (6 KPIs dinâmicos via quiz, valor recalcula por período)
  - Linha SDRPerformanceBlock (col-5) | CloserPerformanceBlock (col-4) | RotatingSlot Coach/Ranking (col-3)
  - Linha NewLeadsBlock (col-5) | Funil de Vendas (col-7, mês fixo)
```

## Blocos

### Termômetro Meta (mês civil fixo)
- Fonte canônica: `useTVDashboardData` → RPC `get_dashboard_metrics` (ADR 2026-04-24)
- `metaVendasMes`, `vendasRealizadas`, `ondeDeveriamEstar`

### SDR Performance Block
- Hook: `src/hooks/useSDRPerformance(range)`
- Marcadas: `pipe_confirmacao` filtrado por `metrics_period_at ?? created_at` no range
- Comparecidas: `meeting_date` no range AND `status=compareceu`
- No-Show: `meeting_date` no range AND `status in (remarcar, perdido)`
- Atribuição: `pre_sale_responsible_id ?? sdr_id` (snapshot dual, [[../../04 — Decisões/ADR-2026-05-18-snapshot-responsible|ADR 2026-05-18]])

### Closer Performance Block
- Hook: `src/hooks/useCloserPerformance(range)`
- Tabela: Reuniões realizadas | Propostas | Vendas | R$ | Ticket médio | Conversão
- Reuniões: `pipe_confirmacao` compareceu, `meeting_date` no range
- Propostas: `pipe_propostas` por `metrics_period_at ?? created_at`
- Vendas: `pipe_propostas` status=vendido, `closed_at` no range
- Atribuição: `sale_responsible_id ?? closer_id`
- Top performer destacado com gradient amber

### Novos Leads Block
- Hook: `src/hooks/useNewLeads(range)`
- Query: `leads` por `created_at` no range
- Sparkline: bucket diário do range
- Top 3 origens (`leads.source`)

### Funil de Vendas (mês fixo)
- Componente: `src/components/tv/SalesFunnel.tsx`
- Dados: `useTVDashboardData` → `data.funnel`
- **Bug fix 2026-05-22**: "Reuniões Marcadas" antes filtrava `meeting_date` → escondia marcações deste mês com meeting futuro. Agora usa `metrics_period_at ?? created_at`.

### Coach IA / Ranking — Slot rotativo
- Componente: `src/components/tv/RotatingSlot.tsx`
- Alterna a cada ciclo do período global
- Painel 1: `<AICoachSection />`
- Painel 2: `<TVCompetitionBlockV2 />` (se competição ativa) ou `<TVRankingSimple />`

## KPI Row dinâmico

Hook `useTVKPIs(range)` calcula 6 valores por período:

| key | label | source |
|---|---|---|
| reunioes | Reuniões | sdrPerf.totals.comparecidas |
| conversao | Conversão | closerPerf.totals.conversao |
| noshow | No-Show | sdrPerf.totals.noShowRate |
| ticket_mrr | Ticket Médio Rec. | Σ sale_value mrr / count |
| ticket_proj | Ticket Médio Proj. | Σ sale_value projeto / count |
| leads | Leads p/ Trabalhar | estado atual (status no pipe), não filtra período |
| leads_novos | Leads Novos | newLeads.total |
| propostas | Propostas | closerPerf.totals.propostas |
| base_ativa | Base Ativa | 0 (placeholder) |
| respostas | Respostas | abordado count |

Seleção dos 6 KPIs vem de `src/lib/tv-config-from-quiz.ts` (onboarding answers).

## Multi-tenancy

`useTVDashboardData` filtra `propostas`/`confirmacoes`/`whatsapp` por `myId` quando não-admin (`useIsAdmin`). Admin vê tudo da org. Os hooks novos (`useSDRPerformance`, `useCloserPerformance`, `useNewLeads`) consomem dos hooks base já filtrados ou usam `organization_id` via `useOrganization`.

## Performance

- Polling 30s (`useTVDashboardData`) + 60s `refetchInterval`
- Relógio só atualiza 1×/min (não 1×/s)
- `useMemo` nos cálculos pesados por range
- Realtime supabase já cuida das atualizações de pipe

## Testes

- `tests/unit/tv-periods.test.ts` (14)
- `tests/unit/useTVDashboardData-funnel.test.ts` (3, regressão bug fix)
- `tests/unit/useSDRPerformance.test.ts` (4)
- `tests/unit/useCloserPerformance.test.ts` (5)
- `tests/unit/useNewLeads.test.ts` (1)
- `tests/unit/hooks-sprint2-tv-dashboard.test.ts` (2)
- `tests/unit/tv-config-from-quiz.test.ts` (existente)

Total: 45 testes passando.

## ADRs relacionadas

- [[../../04 — Decisões/2026-04-24-receita-mes-canonica-projeto|2026-04-24 — receita mês canônica]]
- [[../../04 — Decisões/ADR-2026-05-18-snapshot-responsible|2026-05-18 — snapshot responsible dual]]
- [[../../04 — Decisões/ADR-2026-05-22-tv-dashboard-period-rotation|2026-05-22 — TV período rotativo]]
