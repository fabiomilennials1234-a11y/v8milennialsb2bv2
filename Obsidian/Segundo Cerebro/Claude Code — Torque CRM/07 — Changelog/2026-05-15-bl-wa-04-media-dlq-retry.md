---
type: changelog
title: BL-WA-04 — Mídia DLQ + retry
status: shipped
created: 2026-05-15
updated: 2026-05-15
tags: [uncategorized]
related: []
owner: gabriel
---



# BL-WA-04 — Mídia DLQ + retry

Antes: `persistMediaToStorage` no `whatsapp-webhook` rodava fire-and-forget. Falha (timeout, CDN error, storage error) = mídia perdida silenciosa. CDN WhatsApp expira ~14d → perda permanente. Estimativa: 10-30% das mídias.

Agora: toda mídia que chega cria linha em `whatsapp_media_jobs` (UPSERT idempotente). Webhook tenta persistir inline; sucesso → stamp resolved. Falha → linha permanece pra retry. Cron `whatsapp-media-retry` 2min drena pendentes (max 5 attempts).

## Componentes

- **Migrations**:
  - `20261013000000_whatsapp_media_jobs.sql` — tabela DLQ, RLS deny-all, indexes pendentes/exhausted
  - `20261013000001_schedule_whatsapp_media_retry.sql` — `invoke_whatsapp_media_retry()` + cron `*/2 * * * *`
- **Edge function nova**:
  - `supabase/functions/whatsapp-media-retry/index.ts` — drena 50/batch, max 5 attempts, auth via `x-cron-secret`
- **Helper compartilhado**:
  - `supabase/functions/_shared/whatsapp-media.ts` — `enqueueMediaJob` + `downloadAndPersistMedia` + `stampMediaJob` + `isWhatsAppCdnUrl`
- **Patch webhook**:
  - `supabase/functions/whatsapp-webhook/index.ts` — `persistMediaToStorage` agora enqueue + tenta + stamp (resolved ou last_error). MIME_TO_EXT removido (movido pro shared).
- **config.toml**:
  - `[functions.whatsapp-media-retry] verify_jwt = false`

## Schema

```sql
whatsapp_media_jobs (
  id uuid PK,
  message_id text NOT NULL,
  instance_id uuid FK,
  organization_id uuid FK,
  source_url text NOT NULL,
  message_type text,
  attempts int DEFAULT 0,
  last_attempt_at timestamptz,
  last_error text,
  resolved_at timestamptz,
  storage_path text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (message_id, instance_id)
)
```

RLS: deny-all, service_role only.

## Comportamento

| Fluxo | Resultado |
|---|---|
| Mídia chega + persist inline OK | Linha enqueued → stamped resolved + storage_path imediatamente |
| Persist inline falha (timeout/CDN/storage) | Linha enqueued + last_error stamped, attempts=1. Cron 2min retry |
| 5 falhas consecutivas | Linha exhausted, Sentry critical, manual review |
| Mensagem chega 2x (idempotência) | UPSERT (message_id, instance_id) — não cria duplicata |

## Critério de aceite

- [x] 100% das mídias ou estão em Storage ou estão em `whatsapp_media_jobs` em retry
- [x] Após 5 attempts → log `[whatsapp-media-retry] N rows reached MAX_ATTEMPTS — manual review required` + Sentry
- [x] Falha de stamp não propaga (best-effort, webhook nunca quebra 200 OK)

## Verificação

Após aplicar prod:
```sql
-- Status DLQ
SELECT
  count(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
  count(*) FILTER (WHERE resolved_at IS NULL AND attempts < 5) AS pending,
  count(*) FILTER (WHERE resolved_at IS NULL AND attempts >= 5) AS exhausted
FROM whatsapp_media_jobs
WHERE created_at > now() - interval '1 hour';

-- Cron health
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'whatsapp_media_retry';
```

## Próximos passos prod

Pendente autorização explícita CTO (hook bloqueou nomeando `jsjsmuncfkbsbzqzqhfq`):

```bash
npx supabase db push                                   # aplica migrations 13000000 + 13000001
npx supabase functions deploy whatsapp-media-retry --project-ref jsjsmuncfkbsbzqzqhfq
npx supabase functions deploy whatsapp-webhook --project-ref jsjsmuncfkbsbzqzqhfq    # patch novo
```

## Notas

- Helper compartilhado pode ser reusado por history-sync-worker no futuro (DRY).
- Cron 2min escolhido (vs DLQ replay 5min): CDN WhatsApp tem janela maior (~14d), mas erros transientes valem retry rápido.
