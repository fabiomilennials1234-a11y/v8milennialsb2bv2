---
type: changelog
title: runtime_logs em lote, amostragem de sucesso e retenção
status: active
created: 2026-10-05
updated: 2026-10-05
tags: [changelog, infra, logger, runtime-logs, performance, seguranca]
related: []
owner: claude-agent
---

# 2026-10-05 — runtime_logs em lote, amostragem de sucesso e retenção

## Por quê
- Pico de **19.231 POST/h** em `runtime_logs` (um POST por evento).
- **92k linhas/dia**, das quais **83k são sucesso sem leitor**. Tabela com **694 MB**, sendo **503 MB de índice**.

## Mudanças
- **Logger (`_shared/logger.ts`)**: lote de 100 eventos ou janela de 250 ms, com `waitUntil` e flush no `beforeunload`; um cliente por isolate.
- **Amostragem**: sucesso das 7 actions de alto volume (`SUCCESS_SAMPLE_RATE`) vai ao banco com `_sample_rate`; o resto vira console `rt:1` redigido (vai para `function_logs`).
- **Erro e actorType sempre gravados**, com flush imediato. Lote rejeitado (22/23xxx) reenvia isolado.
- **Console seguro**: telefone, e-mail, CPF/CNPJ (validados por DV) e token mascarados; uuid e data ISO preservados.
- **Banco** (migrations `20271107130001..7`, escritas, **NÃO aplicadas**): índice parcial de erro (CONCURRENTLY); DROP de `status_created` e `org_created` (este só perto de 12/10); REVOKE TRUNCATE em `runtime_logs`/`audit_log`; `purge_system_alerts_resolvidos` (resolvido há >30 d, lote 5.000, cron :50); purga do copilot absorve o job 73; `get_operations_overview` pondera por `1/_sample_rate`.
- **Ops**: `scripts/ops/reindex-runtime-logs-audit-log.sql` (D+2).

## Números do QA
- 1.000 eventos: main **2.364 POSTs** → branch **1** (rajada) / **4** (200 isolados).
- **1,4%** do sucesso chega ao banco; **50/50** erros gravados; `void` + `waitUntil` **31/31**.
- HTTP 500 → 1 relato; 22P02 isolado → **99/100** linhas salvas.

## Testes
- `deno test` logger + comportamento + webhook-ingest: **62/62**; `whatsapp-webhook/`: 24/24.
- `tests/integration/runtime-logs-retencao.test.mjs`: **5/5** (no CI em "SQL regressions").
- `cron-escalonamento-contrato` + `migration-version-collision-contract`: **18/18**.

## Aplicação
Em degraus, descrita no PR: migrations transacionais (130004..7) → índice CONCURRENTLY por psql → DROP status_created → DROP org_created só ~12/10 → deploy só do `whatsapp-webhook` → demais funções uma por vez → REINDEX D+2. **Nunca deploy em massa** (173 funções importam o logger).

## Herdado / follow-ups
- `get_operations_overview` executável por anon (gate interno fecha).
- TRUNCATE concedido em 258 tabelas.
- `reasoning`/`error_message` inteiros no INSERT.
