# 2026-07-09 — Retenção 30d de mídia WhatsApp + estado "mídia expirada"

## Mudanças
- **Storage/WhatsApp**: nova retenção pura de 30 dias para mídia de chat no bucket `media`. Slice 1 de um roadmap de saúde do Storage (o bucket estourou: ~108GB, `whatsapp-media/` = 306.948 arquivos / 99,9%, crescendo ~2GB/dia, sem retenção). Decisão CTO: retenção pura, sem cold storage (R2).
- **Edge function nova** `whatsapp-media-retention`: lista objetos `whatsapp-media/%` com >30d via RPC, deleta pela **Storage API** (`remove()` — libera bytes no S3, diferente de `DELETE` cru em `storage.objects` que orfaniza) em batches, e marca as mensagens correspondentes como `media_expired=true` + `media_url=NULL`. Suporta `?dryRun=1`.
- **DB**: coluna `whatsapp_messages.media_expired` + RPC `list_expired_whatsapp_media()` (prefix-scoped, SECURITY DEFINER read-only) + cron diário 04:00 via pg_net.
- **Frontend**: bubble de chat renderiza estado gracioso "Mídia expirada (retida por 30 dias)" por tipo (imagem/vídeo/áudio/documento), sem `<img>/<video>` quebrado.

## Arquivos tocados
- `supabase/functions/whatsapp-media-retention/index.ts` — edge fn (novo)
- `supabase/functions/whatsapp-media-retention/media-paths.ts` — helpers puros (correlação path→mensagem, escopo, dry-run summary) (novo)
- `supabase/migrations/20270303000000_whatsapp_media_retention.sql` — coluna + RPC + cron (novo)
- `supabase/config.toml` — registra `whatsapp-media-retention` (verify_jwt=false)
- `src/modules/communication/components/chat/media/MessageMedia.tsx` — `ExpiredMedia` + `resolveExpiredMediaKind`
- `src/modules/communication/components/chat/MessagePrimitives.tsx` — wiring do estado expirado
- `src/modules/communication/hooks/chat/types.ts` — `media_expired` em `WhatsAppMessage`
- `src/modules/communication/hooks/chat/useWhatsAppMessages.ts` + `lib/chatPrefetch.ts` — `media_expired` no select
- `tests/unit/whatsapp-media-retention.test.ts` (18 casos) + `tests/unit/message-expired-media.test.tsx` (12 casos)

## Decisões
- **Escopo por prefixo, não por org**: a retenção varre TODAS as orgs; o `organization_id` está embutido no path (`whatsapp-media/{org}/...`). O filtro `name LIKE 'whatsapp-media/%'` (SQL) + `isWhatsAppMediaPath()` (edge, defense-in-depth) garantem que templates/campanhas/avatars/áudio copilot — que compartilham o bucket público sob OUTROS prefixos — nunca sejam deletados.
- **Correlação inbound vs outbound**: inbound (`.../{message_id}.{ext}`) casa por `message_id` (indexado, scoped por org); outbound (`.../{uuid}/{file}`) casa por `media_url LIKE '%'||path` com metacaracteres LIKE escapados. `media_url` guarda a URL pública completa que termina no path.
- **Delete pela Storage API**: `DELETE` cru em `storage.objects` orfaniza os bytes no S3 sem liberar quota — obrigatório usar `storage.from('media').remove()`.
- **`media_expired===true` como gatilho de UI** (não "media_url null"): media_url null também ocorre durante a janela de retry (~14d) e para mídia pendente; usar só a flag evita rotular mídia em trânsito como "expirada". O guard de `<img>` já existente (`isImage && media_url`) garante que nunca há requisição quebrada nesses casos.
- **Retenção 30d não corre com o retry (~14d)**: `whatsapp-media-retry` resgata antes da CDN expirar; 30>14, sem conflito. Retry não foi tocado.

## Segurança
- RPC `list_expired_whatsapp_media` e `invoke_whatsapp_media_retention`: `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` (anon herda EXECUTE via GRANT TO PUBLIC — revoke de anon isolado seria no-op). search_path pinado `public, extensions`.
- Edge fn autentica via `x-cron-secret` / service_role; CORS via `withSecurityHeaders(getCorsHeaders())`; OPTIONS early return.
- IRREVERSÍVEL: mídia > janela CDN não tem fonte de re-fetch. Mitigação: dry-run obrigatório no 1º run, batches, logs estruturados.

## Follow-ups
- **DEV apply pendente**: bloqueado nesta sessão (MCP supabase sem permissão no projeto dev; token/CLI sandboxed; `db push` arrastaria as 28+ migrations divergentes do baseline dev). Migration pronta para aplicar. Validado localmente (lint + typecheck + 30 testes verdes).
- **1º run em PROD = dry-run manual** antes de deixar o cron ligado (`?dryRun=1`), eyeball nas contagens. Só então habilitar o schedule.
- Regen de `src/integrations/supabase/types.ts` após aplicar a migration (coluna `media_expired`).
- **Slices futuros (NÃO neste)**: CAS dedup, compressão/transcode, thumbnails, privatização do bucket + signed URLs, export por conversa.
- O Dossiê DB (`02 — Arquitetura/Dossiê DB — Saúde e Roadmap.md`) auditou table/index bloat mas **ignorou o Storage** — onde estava o problema real (108GB). Considerar estender o dossiê com uma frente de Storage.
