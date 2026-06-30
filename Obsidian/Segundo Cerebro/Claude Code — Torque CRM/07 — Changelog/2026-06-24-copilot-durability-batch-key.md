---
type: changelog
title: 2026-06-24 — Copilot durável — fila com retry/reclaim + batch_key gerado + log de automação na timeline
status: shipped
created: 2026-06-24
updated: 2026-06-24
tags: [copilot, whatsapp, durabilidade, pipelines, retry]
related: [[2026-06-23]]
owner: gabriel
---

# 2026-06-24 — Copilot durável — fila com retry/reclaim + `batch_key` gerado + log de automação na timeline

Batch de durabilidade do Copilot, três commits em `main` no mesmo dia: `19ea1f03` (entrega durável + data correta), `d5d70934` (fix `batch_key`) e `eb5528fc` (log de movimentação de automação na timeline). Todos diagnosticados via `/diagnose`. Migrations aplicadas em prod.

## Mudanças

### 1. Entrega durável — "IA não volta a responder" (`19ea1f03`)

- **Entrega perdida (~3,6% das respostas, 7 orgs)**: a resposta da IA era gerada e logada em `conversation_messages` mas **nunca enviada** ao WhatsApp. Causa raiz: a entrega rodava numa floating-promise dentro do `whatsapp-webhook` **sem** `EdgeRuntime.waitUntil` → o isolate do Supabase Edge era reciclado antes do `.then()` resolver (`agent-message` leva 6–26s + sleeps por chunk). Prova diagnóstica: **zero** sends com `status='failed'` apesar dos não-entregues — a entrega simplesmente sumia.
  - **Fix imediato**: `EdgeRuntime.waitUntil` envolve a entrega (mantém o 200 rápido para o webhook).
  - **Fix durável**: `copilot_message_queue` **ressuscitada** — estava 2× morta (o `insert` falhava por FK apontando para `channel_messages` morto + `conversation_id NOT NULL`, e o worker nunca entregava). Realinhada a `whatsapp_messages`, com política pura de retry/backoff/reclaim (`queue-policy.ts`, TDD), worker reescrito no padrão recover (claim → gera → entrega → retry), sweep cron de 1min e enqueue **canário** por org via env `COPILOT_QUEUE_ENABLED_ORGS`.
- **Data/dia/ano errado** (ex.: "amanhã é quarta, 26/06/2024"): o prompt só dava "Agora" (hoje); o modelo calculava "amanhã" errado e caía na data de treino. `formatTemporalAnchor` passa a injetar **hoje + amanhã já calculados** + instrução anti-memória.

### 2. `batch_key` é coluna gerada — não inserir (`d5d70934`)

- `copilot_message_queue.batch_key` é coluna **GENERATED** (`phone || ':' || organization_id`). O caminho de enqueue ainda incluía `batch_key` explícito no `insert` → o insert **falharia sempre**. Removido o campo; a coluna gera sozinha. Verificado em prod end-to-end.

### 3. Movimentação de automação some da timeline do lead (`eb5528fc`)

- Movimentações de etapa feitas por automação/workflow/copilot **sumiam** da timeline do lead. Root cause: o app pula de propósito o log de stage de automação (`workflow-action-handler`, `log-history` — "PG triggers handle these"), mas o trigger `trg_pipe_*_stage_change` foi **perdido** quando `pipe_whatsapp`/`pipe_confirmacao` viraram VIEWS sobre `pipeline_entries` (migração realtime). Recriado como trigger em `pipeline_entries` (fonte única — views de sistema e sync de custom escrevem nela). Loga **só** moves de automação (`auth.uid() IS NULL`); moves manuais seguem logados pelo frontend → zero duplicação. À prova de exceção (nunca bloqueia a movimentação). Resolve o nome da etapa via `pipelines` + `pipeline_stages`/`custom_pipeline_stages`.

## Arquivos tocados

- `supabase/functions/_shared/copilot/queue-policy.ts` — **novo**. Política PURA de estado/retry (reducer sem I/O: linha + resultado de entrega + agora → patch). `MAX_ATTEMPTS = 5`, backoff e terminação isolados e testáveis.
- `supabase/functions/_shared/copilot/time-context.ts` — `formatTemporalAnchor(now, tz)`: âncora temporal com hoje+amanhã calculados + anti-memória.
- `supabase/functions/agent-message/engine/build-prompt.ts` — injeta `formatTemporalAnchor` na montagem do prompt.
- `supabase/functions/copilot-batch-processor/index.ts` — worker reescrito (claim → gera → entrega → retry, padrão recover).
- `supabase/functions/whatsapp-webhook/index.ts` — `EdgeRuntime.waitUntil` na entrega; enqueue canário gateado por `COPILOT_QUEUE_ENABLED_ORGS`; remoção do `batch_key` explícito do insert.
- `tests/unit/copilot/queue-policy.test.ts` — **novo**. Cobre retry/backoff/reclaim/terminação.
- `tests/unit/time-context.test.ts` — **novo**. Âncora temporal.
- `supabase/migrations/20261129000000_copilot_message_queue_durable_retry.sql` — **novo**. Schema durável: FK → `whatsapp_messages` (`ON DELETE CASCADE`), colunas `attempts` / `next_attempt_at`, índice de elegibilidade (`coalesce(next_attempt_at, '-infinity')`).
- `supabase/migrations/20261129000001_claim_copilot_batch_retry_aware.sql` — **novo**. `claim_copilot_batch` ciente de retry/reclaim.
- `supabase/migrations/20261129000002_copilot_queue_retry_sweep.sql` — **novo**. `sweep_copilot_queue(p_lease_seconds)` + cron `copilot-queue-sweep` (`* * * * *`, pg_net → worker com `x-cron-secret`).
- `supabase/migrations/20261129000003_log_pipeline_stage_change_history.sql` — **novo**. Trigger de log de stage de automação em `pipeline_entries`.

## Decisões

- **Fila durável em vez de só `waitUntil`**: `waitUntil` sozinho ainda perde a entrega se o isolate morrer ou o send falhar. A `copilot_message_queue` realinhada a `whatsapp_messages` dá retry/reclaim observável — é o mecanismo de **recuperação de conversas travadas** (resposta da IA que não saiu volta a ser tentada pelo sweep).
- **Política de retry pura e separada** (`queue-policy.ts`): reducer sem I/O, worker e SQL só aplicam o patch — toda a regra de backoff/terminação fica num módulo testável (TDD).
- **Rollout canário** via `COPILOT_QUEUE_ENABLED_ORGS`: a fila entra org-a-org, não big-bang, dado o histórico de a tabela já ter estado "2× morta".
- **Log de automação só no trigger de DB** (`auth.uid() IS NULL`): evita duplicar o que o frontend já loga em moves manuais; trigger vive em `pipeline_entries` (fonte única) porque os pipes viraram views.

## QA

- `queue-policy` 10/10, `time-context` 33/33, `build-prompt`+fallback 18/18, `uazapi-payload-resolution` 14/14.
- `eb5528fc` verificado em prod RED→GREEN com rollback: move de automação passa a gerar `lead_history` "Etapa alterada para … no funil … (automação)".
- `d5d70934` verificado em prod end-to-end (enqueue passa a inserir sem erro de coluna gerada).

## Follow-ups

- **Rollout da fila**: expandir `COPILOT_QUEUE_ENABLED_ORGS` além do canário conforme as 7 orgs afetadas forem cobertas e o sweep provar estabilidade.
- **Deploy** (não automático): merge em `main` só builda imagem frontend. As edge functions (`whatsapp-webhook`, `copilot-batch-processor`, `agent-message`) precisam de deploy manual; o cron `copilot-queue-sweep` depende de `cron_config` (`copilot_batch_processor_url` + `cron_secret`) populado no ambiente.
