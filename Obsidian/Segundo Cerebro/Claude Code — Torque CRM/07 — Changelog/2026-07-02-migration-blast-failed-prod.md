---
tipo: changelog
data: 2026-07-02
área: campaigns / db
tags: [changelog, migration, prod, disparos, blast-plans]
---

# Migration `20270106000000` aplicada em PROD + deploy mass-send-status

## O que

- `blast_plan_recipients.status` CHECK ganhou `'failed'` (ADR-0016, série #943–#948).
- Edge function `mass-send-status` deployada em prod (`jsjsmuncfkbsbzqzqhfq`) — sync de falha por recipient ativo no cron de 1 min.
- Autorização explícita do CTO na sessão de 2026-07-02.

## Detalhes operacionais

- Migration renomeada `20270104000000` → `20270106000000` (PR #957): timestamp antigo sorteava antes do último aplicado no remoto; push exigiria `--include-all`.
- **Repair de metadata** no ledger de prod: 53 versões históricas (applies antigos via dashboard, sem arquivo no repo) marcadas `reverted` — só contabilidade do CLI, zero mudança de schema.
- Push validado com dry-run: exatamente 1 migration aplicada.

## ⚠️ Débito descoberto — DEV drift

O banco DEV (`bcfadphgsibjzivtbjvc`) tem ~216 migrations do repo nunca aplicadas — **nem a tabela `blast_plan_recipients` existe lá**. Blast Plans rodam só em prod. Migration NÃO aplicada em dev por impossibilidade. Alinhar dev↔repo é trabalho separado a agendar.

## Monitoramento

Sentry no `mass-send-status` (withSentry) — observar 30 min pós-deploy. Sync de falha nunca quebra o refresh do job (try/catch + contrato 200 preservado por construção).
