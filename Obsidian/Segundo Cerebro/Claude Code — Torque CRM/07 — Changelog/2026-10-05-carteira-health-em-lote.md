---
type: changelog
title: calculate-portfolio-health em lote (N+1 → 2 RPCs por página)
status: active
created: 2026-10-05
updated: 2026-10-05
tags: [changelog, carteira, performance, incidente, pg-cron]
related: []
owner: claude-agent
---

# 2026-10-05 — calculate-portfolio-health em lote

## Mudanças
- **Carteira / edge function**: `calculate-portfolio-health` deixa o N+1 por cliente (~6 req REST × 757 clientes, 15 em paralelo ≈ 4.500 req por execução) e passa a ler e gravar em lote: por org, `portfolio_health_inputs` (keyset de 500) → score em memória → `portfolio_health_apply`. Orçamento: 2 req de gating + 2 por página + raras por alerta novo.
- **Score continua em TS**: extraído para `computeClientHealth` em `supabase/functions/_shared/portfolio-health.ts`, sem mudar regra (oráculo congelado do corpo antigo em `tests/unit/portfolio-health-compute.test.ts`).
- **Escrita**: `UPDATE upsell_clients` só onde alguma coluna de saúde mudou (`IS DISTINCT FROM`); antes eram 757 UPDATEs incondicionais com evento de realtime e trigger por linha. `health_updated_at` vira "última mudança".
- **Alertas**: resolve todo alerta aberto cujo tipo parou de disparar (antes, duplicata do mesmo tipo ficava aberta); WhatsApp ao vendedor e `recompra_atrasada` só depois do commit e só para alerta inserido — regra idêntica.
- **Observabilidade**: falha de `portfolio_health_inputs` (statement único sob o timeout de 8 s) marca a org como `inputsFailed`; o `runtime_logs` sai `error` com `orgsFailed` no payload — nunca `success` mudo.
- **Cron**: `21-59/30 * * * *` → `21 6,11-23/2 * * *` (336 → 56 execuções/semana; subconjunto, não fere o TETO do escalonamento de 2026-10-02).
- **Escrito, NÃO aplicado**: migration `20271107120000` (conferida em 2026-10-05 contra o topo do ledger de prod, `20271106000010`, e acima das irmãs `20271107100000`/`20271107110000`) — reconferir o topo ao aplicar; deploy da edge function é do CTO e vem DEPOIS da migration.
- **Empate de `sold_at` (mudança única na 1ª execução)**: a ordenação das últimas linhas de pedido agora é determinística; em prod, ~102 clientes (org de 667) +3 têm o trio das 3 últimas linhas reordenado por empate de `sold_at`, e 68+3 mudam o último produto → `trend`, `ticket_declining` e `product_missing` podem mudar uma vez e estabilizar.

## Arquivos tocados
- `supabase/functions/_shared/portfolio-health.ts` — `computeClientHealth`, `orgAvgTicketFrom`, contrato das RPCs
- `supabase/functions/calculate-portfolio-health/index.ts` — orquestração por página
- `supabase/migrations/20271107120000_portfolio_health_set_based.sql` — RPCs INVOKER, grants só service_role, cron por jobname
- `tests/integration/portfolio-health-rpc.test.mjs` + `fixtures/portfolio-health-baseline.sql` — PGlite
- `tests/unit/portfolio-health-compute.test.ts`, `calculate-portfolio-health-orchestration.test.ts`, `portfolio-health-cron-contrato.test.ts`

## Decisões
- Score fica em TS: portar para SQL criaria um terceiro gêmeo da regra (arredondamento, `toLocaleString`, metadata) sem ganho de requisição.
- RPCs `SECURITY INVOKER` com `REVOKE` explícito de anon/authenticated (default ACL de prod dá EXECUTE nominal) e fail-closed no apply para cliente fora da org.

## Follow-ups
- Ordem de deploy: migration → edge function. Edge nova contra banco sem as RPCs falha a org inteira sem escrever; edge velha segue funcionando com a migration aplicada.
- Sombra pós-deploy: comparar `n_tup_upd` de `upsell_clients` antes/depois de uma execução.
