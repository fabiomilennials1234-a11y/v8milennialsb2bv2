---
date: 2026-04-17
branch: develop
agents: [Conductor, DBA, Frontend, QA]
---

# 2026-04-17 — Fix receita do mês / MRR

## Task

Corrigir dado de "receita do mês" que aparecia como valor total contratado ao longo do contrato (sale_value × contract_duration), em vez das vendas que efetivamente entraram no mês.

## Diagnóstico

A RPC `get_dashboard_metrics` (última versão em [20260911000000_fix_dashboard_conversion_rate.sql](../../../../supabase/migrations/20260911000000_fix_dashboard_conversion_rate.sql)) multiplicava `sale_value × contract_duration` para MRR em 3 agregados:

| Campo | Antes (bug) | Depois (fix) |
|-------|-------------|--------------|
| `vendaTotal` | `Σ (sale_value × duration)` para MRR | `Σ sale_value` |
| `vendaBaseAtiva` | mesma coisa | `Σ sale_value` |
| `vendaPrimeiroPedido` | mesma coisa | `Σ sale_value` |
| `ticketMedio` | inflado (= vendaTotal / funnelVendas) | `vendaTotal / funnelVendas` correto |
| `vendaMRR` | já estava correto | inalterado |
| `vendaProjeto` | já estava correto | inalterado |

**Exemplo**: venda MRR de R$ 1.000/mês × 12 meses → dashboard mostrava R$ 12.000 como "Faturamento do Mês" em vez de R$ 1.000.

**Histórico**:
- `20260708000004` ADICIONOU a multiplicação intencionalmente (confundiu LTV com receita do mês)
- `20260829400000` removeu
- `20260911000000` regrediu ao reescrever a RPC para corrigir `taxaConversao`

## Regra oficial

**Receita do mês = o que entrou no período, sem multiplicar por contract_duration.**

- Para MRR: `sale_value` representa valor mensal recorrente. `vendaMRR` soma isso direto. Correto.
- Para Projeto: `sale_value` é valor único.
- `vendaTotal` = soma de todas as vendas no período = `vendaMRR + vendaProjeto + outros`. Nunca multiplicar.
- `vendaBaseAtiva` e `vendaPrimeiroPedido` seguem a mesma regra.
- Se for necessário expor "valor total contratado" (LTV-like) em algum card, deve ser um campo separado e explicitamente nomeado (ex.: `valorTotalContratado`), NUNCA `vendaTotal`.

## Correções aplicadas (branch `develop`)

### Migration nova

[supabase/migrations/20260417100000_fix_receita_mes_mrr_contract_duration.sql](../../../../supabase/migrations/20260417100000_fix_receita_mes_mrr_contract_duration.sql) — recria `get_dashboard_metrics` removendo as 3 ocorrências de `× v_duration` no bloco MRR. Preserva integralmente o resto (taxaConversao, filtros, campos retornados, signature, grants).

### Evidência objetiva

[tests/sql/validate_receita_mes_mrr.sql](../../../../tests/sql/validate_receita_mes_mrr.sql) — script que cria fixtures (1× MRR com sale_value=1000, duration=12 + 1× Projeto com sale_value=5000), chama a RPC e valida via `ASSERT`:
- `funnelVendas = 2`
- `vendaMRR = 1000` (mensal)
- `vendaProjeto = 5000`
- `vendaTotal = 6000` (sem × 12 — antes seria 17.000)
- `ticketMedio = 3000`
- Roda em transação com `ROLLBACK` — não persiste fixtures.

## Consumidores no frontend (impacto)

Todos recebem agora o valor correto automaticamente (sem mudança de código):

| Arquivo | Campo | O que exibia antes / exibe agora |
|---------|-------|----------------------------------|
| [TabVisaoGeral.tsx](../../../../src/components/dashboard/TabVisaoGeral.tsx) | `vendaTotal`, `ticketMedio`, `vendaBaseAtiva`, `vendaPrimeiroPedido` | KPI "Faturamento", comparação com meta, breakdown de clientes |
| [TabInteligencia.tsx](../../../../src/components/dashboard/TabInteligencia.tsx) | `vendaTotal` | Indicador de ritmo/meta |
| [SalesBreakdown.tsx](../../../../src/components/dashboard/SalesBreakdown.tsx) | `vendaTotal` | totalVendas |
| [SegmentBenchmark.tsx](../../../../src/components/dashboard/SegmentBenchmark.tsx) | `ticketMedio` | Benchmark do segmento |
| [Premiacoes.tsx](../../../../src/pages/Premiacoes.tsx), [Metas.tsx](../../../../src/pages/Metas.tsx), [Performance.tsx](../../../../src/pages/Performance.tsx) | `vendaTotal` | Progresso de meta de faturamento |

## Verificação

- `npx tsc --noEmit -p tsconfig.app.json` — 0 erros novos
- `npm run build` — sucesso em 17.04s
- Script SQL de validação escrito em `tests/sql/validate_receita_mes_mrr.sql` (requer aplicar migration no dev para rodar)

## Pendente

- **Aplicar `20260417100000_fix_receita_mes_mrr_contract_duration.sql` no dev (`bcfadphgsibjzivtbjvc`)** via SQL Editor: https://supabase.com/dashboard/project/bcfadphgsibjzivtbjvc/sql/new
- Depois, rodar `tests/sql/validate_receita_mes_mrr.sql` no mesmo SQL Editor para validação objetiva
- Abrir dashboard com org real e comparar receita do mês antes/depois

## Invariantes reforçados

- `get_dashboard_metrics.vendaTotal` = soma das vendas do período, sem multiplicar por contract_duration
- `sale_value` de um produto MRR armazena valor mensal recorrente; dashboard trata como tal
- Se precisar de "valor total contratado" → campo separado, nunca reusar `vendaTotal`
- Produção (`jsjsmuncfkbsbzqzqhfq`) NÃO foi tocada
