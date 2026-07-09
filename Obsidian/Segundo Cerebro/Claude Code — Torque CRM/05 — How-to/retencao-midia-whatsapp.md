# How-to — Retenção de mídia WhatsApp (30 dias)

Como operar a retenção de mídia de chat do bucket `media`. Contexto: o bucket
público compartilhado estourou (~108GB, `whatsapp-media/` = 99,9% dos arquivos).
Decisão CTO: retenção pura de 30 dias, sem cold storage.

Ver changelog: `07 — Changelog/2026-07-09-whatsapp-media-retention.md`.

## O que faz

`whatsapp-media-retention` (edge fn, cron diário 04:00):
1. Lista objetos `media` sob o prefixo `whatsapp-media/` com `created_at > 30d`
   (RPC `list_expired_whatsapp_media`, read-only, prefix-scoped).
2. Deleta pela **Storage API** (`remove()`) em batches de 200 — libera bytes no
   S3 de verdade (um `DELETE` cru em `storage.objects` orfaniza).
3. Marca as mensagens: `media_url=NULL` + `media_expired=true`. Inbound casa por
   `message_id` (path `whatsapp-media/{org}/{message_id}.{ext}`), outbound por
   `media_url LIKE '%'||path` (path `whatsapp-media/{org}/{uuid}/{file}`).
4. UI mostra "Mídia expirada (retida por 30 dias)" por tipo, sem `<img>` quebrado.

## Escopo (CRÍTICO)

Só deleta `whatsapp-media/`. Message templates, campanhas, avatars e áudio do
copilot vivem no MESMO bucket sob OUTROS prefixos e NUNCA são tocados. Duplo
guard: `LIKE 'whatsapp-media/%'` no SQL + `isWhatsAppMediaPath()` na edge fn.

## Dry-run (sempre antes de ligar em ambiente novo)

O 1º run em qualquer ambiente deve ser dry-run manual. Retorna contagens sem
deletar nada:

```bash
curl -X POST \
  'https://<project-ref>.supabase.co/functions/v1/whatsapp-media-retention?dryRun=1' \
  -H 'x-cron-secret: <CRON_SECRET>'
```

Resposta:

```json
{ "dryRun": true, "retention_days": 30, "deleted_count": 12345,
  "freed_bytes_estimate": 9876543210, "orgs_affected": 27,
  "messages_marked": 0, "batches": 0 }
```

Confira `deleted_count` / `freed_bytes_estimate` / `orgs_affected`. Se fizer
sentido, deixe o cron rodar (ou dispare sem `?dryRun=1` para o primeiro run real).

## Rodar de verdade (manual)

```bash
curl -X POST \
  'https://<project-ref>.supabase.co/functions/v1/whatsapp-media-retention' \
  -H 'x-cron-secret: <CRON_SECRET>'
```

Idempotente — re-rodar não acha nada novo (arquivos já foram). Cada invocação
processa até 2000 arquivos (bound de runtime); o cron diário drena o resto ao
longo dos dias até estabilizar no regime de ~2GB/dia entrando / 30d saindo.

## Cron

Agendado por `20270303000000_whatsapp_media_retention.sql`:
`cron.schedule('whatsapp_media_retention', '0 4 * * *', ...)` → `invoke_whatsapp_media_retention()`
→ pg_net POST com `x-cron-secret`. Para pausar:

```sql
SELECT cron.unschedule('whatsapp_media_retention');
```

## Refs

- Deploy da edge fn: `05 — How-to/deploy-edge-function.md` (dev `bcfadphgsibjzivtbjvc`, prod `jsjsmuncfkbsbzqzqhfq`)
- Não confundir com `whatsapp-media-retry` (cron 2min) que RESGATA mídia da CDN
  antes de expirar (~14d). Retenção (>30d) não corre com o retry.
- Áreas frágeis WhatsApp: `06 — Features/Chat/`
