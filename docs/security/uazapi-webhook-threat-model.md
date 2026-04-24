# Threat Model — whatsapp-webhook (Uazapi ingress)

## Escopo

Endpoint público `POST /functions/v1/whatsapp-webhook/<SECRET>[/<event>]` consumido pela Uazapi (server-to-server).

## Findings da doc Uazapi (v2.0.1)

- **Sem HMAC nativo**: Uazapi não assina payloads de webhook.
- **Sem customHeaders**: `POST /instance/updateWebhook` aceita apenas `url`, `events`, `excludeMessages`, `addUrlEvents`, `addUrlTypesMessages`.
- **URL é único vetor de auth**: secret embutido no path.
- **Retry em falha**: `/webhook/errors` mantém histórico em memória (20 erros). Política de retry não documentada explicitamente.
- **Eventos**: `connection`, `history`, `messages`, `messages_update`, `newsletter_messages`, `call`, `contacts`, `presence`, `groups`, `labels`, `chats`, `chat_labels`, `blocks`, `sender`.
- **Filtros**: `wasSentByApi`, `wasNotSentByApi`, `fromMeYes`, `fromMeNo`, `isGroupYes`, `isGroupNo`.

## Decisão de auth

Secret como segmento de path. Uazapi configurada via `updateWebhook`:

```
https://<supabase-ref>.supabase.co/functions/v1/whatsapp-webhook/<UAZAPI_WEBHOOK_SECRET>
```

Com `addUrlEvents: true`:

```
.../whatsapp-webhook/<UAZAPI_WEBHOOK_SECRET>/<event>
```

Edge function extrai segmento pós-`whatsapp-webhook`, compara via `timingSafeEqual`. Falha → 404 (evita enumeração).

## STRIDE

### Spoofing
- Mitigação: secret path + `timingSafeEqual`. Tenant via `whatsapp_instance_secrets` lookup.
- Gap: sem HMAC, vazamento de secret permite spoof até rotação.

### Tampering
- HTTPS enforced. Body size 2MB cap. Schema validation por evento.
- Gap: sem body HMAC, atacante-com-secret injeta qualquer payload.

### Replay
- UPSERT idempotente (`message_id, instance_id`) já cobre.
- Janela 5min via `payload.timestamp` quando presente.
- Gap: nonce cache Fase 2 ausente.

### Repudiation
- `runtime_logs` via `logRuntime` em todo attempt (sucesso + auth_fail + rate_limit).

### Information disclosure
- Logger redacta. Error responses genéricas (404/400/500 sem detalhe).
- Gap: PII (remote_jid, number) em audit logs — minimum necessário.

### DoS
- Rate limit 1000/min por IP (in-memory). Body cap 2MB. Timeout 12s.

### Elevation
- Tenant resolution lookup → nunca body. 200 silent em instance unknown.

## Decisões arquiteturais

| # | Decisão |
|---|---|
| D1 | Auth: secret em path + `timingSafeEqual` |
| D2 | 404 em auth fail (anti-enumeração) |
| D3 | Replay window 5min |
| D4 | Rate limit 1000/min por IP |
| D5 | Body 2MB cap |
| D6 | Timeout 12s |
| D7 | Tenant via `whatsapp_instance_secrets` lookup |
| D8 | Eventos Fase 2: `messages`, `messages_update`, `connection` |
| D9 | UPSERT `(message_id, instance_id)` preservado |
| D10 | Error response genérica |
| D11 | Logger redact automático via `logRuntime` |
| D12 | `verify_jwt = false` |
| D13 | `updateWebhook` envia URL com secret + `excludeMessages:[wasSentByApi]` + `addUrlEvents:true` |

## Follow-up

- [ ] **[HIGH]** HMAC quando Uazapi oferecer
- [ ] **[MEDIUM]** Rate limit → KV/Redis antes volume prod
- [ ] **[MEDIUM]** Nonce cache replay full coverage
- [ ] **[LOW]** IP allowlist quando Uazapi publicar IPs fixos
