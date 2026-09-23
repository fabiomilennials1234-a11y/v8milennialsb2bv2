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
- **Métricas**: `uazapi_resolved_by_*` em `runtime_logs`
- **Contract tests**: 14 testes Vitest pra detectar schema drift

Ver [`05 — How-to/debug-whatsapp`](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/05%20—%20How-to/debug-whatsapp.md).

## Fluxo

1. Recebe POST de Uazapi (secret path)
2. Valida `UAZAPI_WEBHOOK_SECRET` pelo caminho/header aceito no handler
3. Resolve instância via cascata:
   - `payload.instance` (V1) →
   - `payload.token` →
   - hash do número →
   - DLQ persistida + ACK; falha de persistência não autoriza ACK
4. Idempotência via `external_message_id` único
5. INSERT em `whatsapp_messages` + `whatsapp_messages_received_via`
   (o inbound da Uazapi NÃO vai para `channel_messages` — essa é da Meta e do
   quick-blast. Quem quiser reagir a mensagem recebida escuta `whatsapp_messages`.)
6. Realtime notifica frontend
7. Dispara workflow/copilot triggers (assíncrono)
8. Retorna 200 após processamento; erro retorna 500/503. DLQ de resolução não cobre automaticamente falhas do processamento.

## Não fazer

- ❌ Confiar 100% em `payload.instance` — schema instável
- ❌ Confirmar 2xx após falha sem persistência durável; retry precisa ser idempotente
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
- `whatsapp_messages` — destino final das msgs da Uazapi
- `notifications` — Aviso de conversa, emitido por trigger em `whatsapp_messages` (#1885)

## Testes obrigatórios

```bash
npx vitest run tests/unit/uazapi-payload-resolution.test.ts
```

14 cenários: V1 payload, V2 payload (sem instance), V2 sem token, group msg,
media, edit, delete, react, etc.

**Se falhar** → schema Uazapi mudou. Investigar antes de qualquer fix.

## Métricas (runtime_logs)

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


## Extração do ingresso — capacidade Supabase (2026-09-23)

`index.ts` registra `Deno.serve`; `handler.ts` contém o núcleo compartilhado.
`message-update.ts` aplica recibos com progressão atômica, reações legadas com
CAS e erros de persistência propagados. O helper de propostas comerciais recebe
modo estrito neste caminho: duplicata também pode terminar efeito interrompido.

`services/whatsapp-ingress/` reutiliza esse núcleo. Serviço desligado por padrão;
allowlist usa instância resolvida no banco. Primeira migração de tráfego limitada
a `messages_update`, com admissão durável antes do ACK e retries controlados.
Não tratar o serviço como ativo em produção: contrato remoto, pico no VPS,
latência, reinício e rollback são gates independentes do build.

Snapshots de reações e pin/unpin não carregam versão confiável em todos os
payloads. Serialização da fila evita reordenação criada pelo worker; não prova
ordem causal do fornecedor. Não ativar dois donos de efeitos para a mesma rota.

Testes adicionais: `whatsapp-message-update.test.ts`, `quote-receipt.test.ts`,
`whatsapp-ingress-runtime.test.ts`. Plano/evidência histórica em
`.specs/supabase-capacity-phase2-plan.md` e `docs/operations/supabase-capacity-*`.
