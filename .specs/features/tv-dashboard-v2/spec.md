# TV Dashboard v2

Data: 2026-05-22
Owner: CTO
Status: in-progress

## Objetivo

Evoluir TV Dashboard com:
1. Métricas SDR por dia (marcadas, comparecidas, no-show) + total
2. Métricas closer por período (reuniões, propostas, vendas, $, ticket, conv)
3. Período rotativo global (hoje → 7d → 2sem → mês civil)
4. Bloco "Novos Leads" por período
5. Corrigir bug funil (reuniões marcadas filtra `meeting_date` em vez de marcação)

## Princípios

- **Período rotativo global** sincronizado via Context. Auto-cycle 12s. Sem pause.
- Períodos: `hoje | 7d | 2sem | mes`. `mes` = dia 1 do mês corrente → agora. **Nunca rolling 30d.**
- **Termômetro Meta = sempre mês civil**. Não acompanha rotação (meta é mensal).
- **Coach IA / Ranking** = slot rotativo (alternam ~12s).
- Remover bloco "Vendas do Mês" (lista). Funil + Closer block cobrem.
- KPI row vira **resumo do período** (totais agregados, mudam quando período troca).

## Atribuição de crédito (snapshot dual, ADR 2026-05-18)

- SDR: `pre_sale_responsible_id ?? sdr_id`
- Closer: `sale_responsible_id ?? closer_id`

## Filtro temporal por semântica

| Evento | Coluna | Fonte |
|---|---|---|
| Reunião marcada | `metrics_period_at ?? created_at` | pipe_confirmacao |
| Compareceu / no-show | `meeting_date` | pipe_confirmacao |
| Proposta enviada | `metrics_period_at ?? created_at` | pipe_propostas |
| Venda fechada | `closed_at` (ADR 2026-04-24) | pipe_propostas |
| Novo lead | `created_at` | leads |

## Bug funil (Fase 2)

`useTVDashboardData.ts:259` define `reunioesMarcadasFunnel = currentMonthConfirmacoes.length` onde `currentMonthConfirmacoes` filtra por `meeting_date`. Reunião marcada em maio com meeting em junho → some no funil.

**Fix**: split em dois conjuntos:
- `confirmacoesMarcadasNoMes` — filtro `metrics_period_at ?? created_at` no mês. Usado para "Reuniões Marcadas".
- `confirmacoesEventoNoMes` — filtro `meeting_date` no mês. Usado para "Comparecidas" + "No-Show".

## Blocos

### 1. Termômetro Meta (mantido)
Sempre mês civil. Não rotaciona.

### 2. KPI Row (resumo período)
6 KPIs derivados do quiz. Valores recalculam quando período muda.

### 3. SDR Performance Block (novo) — substitui Funil de Vendas atual
Header: "Pré-Vendas · {período}"
3 sub-blocos verticais:
- Marcadas (total topo, lista SDR ordenada desc + mini-bar)
- Comparecidas (idem)
- No-Show (idem, cor amber/red)

### 4. Closer Performance Block (novo)
Tabela compacta por closer:
| Closer | Reuniões | Propostas | Vendas | R$ | Ticket | Conv |

Top performer highlight.

### 5. Novos Leads Block (novo)
- Big number total no período
- Sparkline diário (buckets do range)
- Top 3 sources

### 6. Funil de Vendas (mantido, corrigido)
Mantém componente atual mas usa dados corrigidos. Não rotaciona — sempre mês.

### 7. Coach IA / Ranking — slot rotativo
Alterna a cada cycle do período (12s).

## Layout proposto (12 cols)

```
Header: logo | título | PeriodPill | hora | refresh | fullscreen

Row 0 (col-12): KPIRow (6 KPIs, resumo período)

Row 1:
- col-3: Termômetro (mês fixo)
- col-5: SDRPerformanceBlock (período)
- col-4: CloserPerformanceBlock (período)

Row 2:
- col-4: NewLeadsBlock (período)
- col-4: Funil (mês fixo, corrigido)
- col-4: Coach IA / Ranking (slot rotativo)
```

## Componentes / hooks novos

- `src/lib/tv-periods.ts` — helpers + tipos
- `src/contexts/TVPeriodContext.tsx` — provider + hook
- `src/components/tv/PeriodPill.tsx`
- `src/components/tv/SDRPerformanceBlock.tsx`
- `src/components/tv/CloserPerformanceBlock.tsx`
- `src/components/tv/NewLeadsBlock.tsx`
- `src/hooks/useSDRPerformance.ts`
- `src/hooks/useCloserPerformance.ts`
- `src/hooks/useNewLeads.ts`

## Testes

- `tests/unit/tv-periods.test.ts`
- `tests/unit/useTVDashboardData-funnel.test.ts` (regressão)
- `tests/unit/useSDRPerformance.test.ts`
- `tests/unit/useCloserPerformance.test.ts`
- `tests/unit/useNewLeads.test.ts`

## Out of scope

- Edit period manually (sem botão next/prev)
- Pause em hover (TV não interage)
- Persist period preference (não tem usuário logado em modo TV puro)
