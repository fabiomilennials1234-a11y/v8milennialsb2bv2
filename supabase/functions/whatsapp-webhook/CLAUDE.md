# CLAUDE.md — `whatsapp-webhook` edge function

Entrada de eventos Uazapi (inbound). Resolve instância → grava em DB → dispara
realtime + triggers (workflow, copilot).

> Área 🔴 Crítica. Ver
> [`Obsidian/.../06 — Features/Chat/whatsapp-stability-plan.md`](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/06%20—%20Features/Chat/whatsapp-stability-plan.md).
>
> Patch defensivo + helpers de resolução são **intocáveis sem teste regressivo**.
> Tem contract test Vitest:
> `npx vitest run tests/unit/uazapi-payload-resolution.test.ts`

## Contexto crítico — incidente 2026-05-14

Uazapi server-side deploy mudou shape do payload V2 em produção. `payload.instance`
deixou de ser confiável em ~44% dos eventos. V8 começou a dropar webhooks
silenciosamente (~3900 msgs perdidas em 22h).

Mitigação shipped:
- **Patch defensivo**: resolução de instância com fallback por token, hash, número
- **DLQ**: `whatsapp_webhook_dlq` grava events que não resolveram
- **Replay**: `whatsapp-dlq-replay` cron 5min drena DLQ
- **Métricas**: `uazapi_resolved_by_*` Sentry events
- **Contract tests**: 14 testes Vitest pra detectar schema drift

Ver [`05 — How-to/debug-whatsapp`](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/05%20—%20How-to/debug-whatsapp.md).

## Fluxo

1. Recebe POST de Uazapi (secret path)
2. Valida `UAZAPI_WEBHOOK_SECRET` (header)
3. Resolve instância via cascata:
   - `payload.instance` (V1) →
   - `payload.token` →
   - hash do número →
   - DLQ + return 200
4. Idempotência via `external_message_id` único
5. INSERT em `channel_messages` + `whatsapp_messages_received_via`
6. Realtime notifica frontend
7. Dispara workflow/copilot triggers (assíncrono)
8. Return 200 sempre (mesmo em erro de processing — DLQ pega)

## Não fazer

- ❌ Confiar 100% em `payload.instance` — schema instável
- ❌ Retornar 500 em erro — Uazapi retry agressivo, prefere DLQ + 200
- ❌ Bloquear no processing — pesado vai pra cron
- ❌ Sem idempotência — webhook duplicado é normal
- ❌ Pular DLQ em caso de erro — perda silenciosa

## Headers + envs

- `x-webhook-secret: <UAZAPI_WEBHOOK_SECRET>` — validar
- `UAZAPI_BASE_URL` — pra logs/debugging
- `UAZAPI_ADMIN_TOKEN` — pra admin probes em runtime
- `SUPABASE_SERVICE_ROLE_KEY` — pra writes que bypassam RLS

## Schema dependencies

- `whatsapp_instances` — lookup target
- `whatsapp_instance_secrets` — tokens (RLS deny-all)
- `whatsapp_webhook_dlq` — DLQ
- `whatsapp_messages_received_via` — tracking origem
- `channel_messages` — destino final msgs

## Testes obrigatórios

```bash
npx vitest run tests/unit/uazapi-payload-resolution.test.ts
```

14 cenários: V1 payload, V2 payload (sem instance), V2 sem token, group msg,
media, edit, delete, react, etc.

**Se falhar** → schema Uazapi mudou. Investigar antes de qualquer fix.

## Métricas Sentry

- `whatsapp_resolved_by_payload_instance` (V1 path)
- `whatsapp_resolved_by_token_fallback` (V2 path)
- `whatsapp_missing_instance` (DLQ path)
- `whatsapp_idempotent_dup` (já processado)

## Logs

```bash
supabase functions logs whatsapp-webhook --project-ref jsjsmuncfkbsbzqzqhfq
```

## Related

- `whatsapp-api-proxy` — outbound counterpart (JWT + tenant + rate limit)
- `whatsapp-dlq-replay` — replay cron (5min)
- `whatsapp-session-watchdog` — dead session detector (10min)
- `whatsapp-health-monitor` — drift + health (5min)
- `whatsapp-rebind-webhook` — reconfigura webhook em Uazapi
- `history-sync-worker` — backfill
