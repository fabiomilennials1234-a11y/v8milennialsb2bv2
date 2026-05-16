---
type: howto
title: Debug Fluxo WhatsApp
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [howto, debug, whatsapp, uazapi]
related: ["[[whatsapp-stability-plan]]", "[[rebind-uazapi-webhook]]"]
owner: gabriel
---

# Como debugar fluxo WhatsApp

> Pipeline: Lead → Uazapi → webhook → DB → realtime → UI.
> Quebra pode estar em qualquer ponto.

## Checagem rápida — health dashboard

`/master/whatsapp-health` (master only):
- Instâncias ativas vs total
- Sessões mortas
- DLQ count
- Drift score
- Última msg recebida por instância

## Por sintoma

### "Mensagem não chegou no chat"

1. Lead enviou de fato? Pedir screenshot.
2. Logs Uazapi: dashboard `https://milennialstech.uazapi.com` (admin token)
3. Logs `whatsapp-webhook`:
   ```bash
   supabase functions logs whatsapp-webhook --project-ref jsjsmuncfkbsbzqzqhfq
   ```
4. DLQ check:
   ```sql
   SELECT reason, count(*), max(received_at)
   FROM whatsapp_webhook_dlq
   WHERE resolved_at IS NULL
   GROUP BY reason;
   ```
5. Tabela direta:
   ```sql
   SELECT * FROM channel_messages
   WHERE organization_id = '<id>'
     AND created_at > now() - interval '1 hour'
   ORDER BY created_at DESC LIMIT 20;
   ```
6. Realtime channel — UI subscreveu? Inspecionar via DevTools network → WS

### "Sessão WhatsApp morta"

```sql
SELECT id, instance_name, session_dead_since, session_dead_reason
FROM whatsapp_instances
WHERE organization_id = '<id>'
  AND session_dead_since IS NOT NULL;
```

Fix: re-pair via UI `/configuracoes/whatsapp` (mostra QR code novo).

### "Mensagens duplicadas"

- Realtime + history-sync podem race. Verificar `whatsapp_messages_received_via`
- Webhook reentry: idempotência via `external_message_id` único.

### "Envio (outbound) falhou"

```sql
SELECT * FROM uazapi_sender_jobs
WHERE organization_id = '<id>'
  AND status IN ('failed', 'pending')
ORDER BY created_at DESC LIMIT 20;
```

Logs `whatsapp-api-proxy`:
```bash
supabase functions logs whatsapp-api-proxy --project-ref jsjsmuncfkbsbzqzqhfq
```

### "Webhook não está sendo chamado"

Possível causa: Uazapi config drift. Solução: rebind. Ver
[[rebind-uazapi-webhook]].

## Backfill (histórico perdido)

```sql
-- Criar job de backfill incremental
INSERT INTO history_sync_jobs (
  organization_id, instance_id, scope, status, created_at
) VALUES (
  '<org>', '<instance>', 'incremental', 'pending', now()
);
```

Worker pg_cron drena (`history-sync-worker` a cada 5min).

Monitor:
```sql
SELECT i.instance_name, h.status, h.total_fetched, h.chats_completed,
       h.total_chats, h.error
FROM history_sync_jobs h
JOIN whatsapp_instances i ON i.id = h.instance_id
WHERE h.created_at > now() - interval '24 hours'
ORDER BY h.created_at DESC;
```

## Sentry tags úteis

(BL-WA-09 pendente — estruturar tags)
- `whatsapp.org_id`
- `whatsapp.instance_id`
- `whatsapp.path` (webhook/proxy/cron)
- `whatsapp.reason` (DLQ reasons)

## Vitest contract test

```bash
npx vitest run tests/unit/uazapi-payload-resolution.test.ts
```

Falha = schema Uazapi mudou (provider deploy). Investigar antes de qualquer fix.

## Referências

- [[whatsapp-stability-plan]] — estado consolidado
- [[whatsapp-stability-100pct]] — backlog 14 items
- `docs/INCIDENT_2026_05_14_UAZAPI_V2.md` — incidente raiz
- `docs/WHATSAPP_STABILITY_PLAN.md` — plano original
