# 2026-07-09 — scheduled_date: piso na janela de graça (offset zero)

## Mudanças
- **workflows (área frágil)**: gatilho `scheduled_date` ("Antes de uma data") passou a disparar de forma confiável para dispatches de **offset curto/zero** (ex.: "no dia da reunião", `value: 0, unit: days`). Antes, `graceMs = min(offsetMs/2, cap)` dava grace **0** para offset 0 → janela de largura zero → o cron de ~1 min nunca acertava o disparo e a mensagem nunca saía.

## Arquivos tocados
- `supabase/functions/_shared/workflow-trigger.ts` — nova const `SCHEDULED_GRACE_FLOOR_SECONDS = 120`; `graceMs` agora é `min(max(offsetMs/2, floor), cap)`. Só afeta offsets onde `offsetMs/2 < 120s` (≤ ~4 min); offsets maiores permanecem idênticos.
- `tests/unit/workflow-trigger-scheduled-date.test.ts` — bloco de regressão "offset zero (no dia da reunião)": dispara no send_time e em `fireAt+60s`; não dispara antes do send_time nem em `fireAt+5min` (janela perdida preservada).

## Decisões
- Piso = 120s (~2 ticks do cron `workflow-cron-triggers`). Pequeno o bastante para não reabrir janelas legitimamente perdidas (outage/antecedência que não coube), grande o bastante para o cron de 1 min sempre pegar.

## Contexto de negócio
- Habilita o toque "no dia de manhã" (08:00) da **Cadência de Confirmação de Reunião da Basic4u** (org `163874dd-...`). Os 2 primeiros toques (stage_changed "ao marcar" + scheduled_date "1 dia antes") já existiam como workflows DESLIGADOS no PROD.

## Follow-ups
- Deploy da edge function `process-workflow-executions` no PROD (`jsjsmuncfkbsbzqzqhfq`) para o fix valer.
- Criar o 3º workflow (scheduled_date, `value: 0, send_time: 08:00`) e revisar/ativar a cadência.
