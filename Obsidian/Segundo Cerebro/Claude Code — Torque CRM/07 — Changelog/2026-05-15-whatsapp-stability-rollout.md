---
type: changelog
title: 2026-05-15 — Incidente Uazapi V2 + rollout estabilização
status: shipped
created: 2026-05-15
updated: 2026-05-15
tags: [uncategorized]
related: []
owner: gabriel
---



# 2026-05-15 — Incidente Uazapi V2 + rollout estabilização

## TL;DR

Resolvido incidente que dropou ~3900 mensagens de 8 orgs por ~22h (2026-05-14 ~20:00 UTC → 2026-05-15 13:28 UTC). Causa: Uazapi deploy mudou shape do payload V2 em produção, V8 não tolerava. Mitigação: patch defensivo + rebind 39 webhooks + DLQ + watchdog + health monitor + dashboard. Total ~5h investigação + impl. Branch `fix/whatsapp-rebind-webhook` (4 commits).

## Linha do tempo (UTC)

- **2026-05-14 ~20:00**: Uazapi server-side deploy. `payload.instance` deixa de ser confiável em ~44% dos eventos. V8 começa a dropar webhooks silenciosamente.
- **2026-05-14 19:00→23:00**: 504+430+259+80 erros `uazapi_missing_instance`. Sem alerta — drop retornava 200.
- **2026-05-15 ~12:30**: Investigação inicia. Barulinho Bom reportou parada total de mensagens.
- **2026-05-15 12:30→13:25**: Root cause confirmada via Uazapi `/instance/all` + `/message/find` admin probes.
- **2026-05-15 13:27**: Patch defensivo deployed em `whatsapp-webhook`.
- **2026-05-15 13:28**: 39 webhooks rebound com config canônica.
- **2026-05-15 13:29**: `uazapi_missing_instance` cai a 0/min. `uazapi_resolved_by_token_fallback` (path novo) carrega ~50% do tráfego — confirma hipótese empiricamente.
- **2026-05-15 13:46**: 13 history_sync_jobs scope=incremental queued pra backfill das 22h perdidas.
- **2026-05-15 ~14:00→15:00**: Implementação + deploy dos 6 componentes do plano de estabilização.

## Causa raiz

3 shapes de payload V2 chegam do Uazapi, nenhum carrega `instance`/`instance_id` top-level confiável:

1. `{"event": "messages", ...}` — event como string
2. `{"event": "<uazapi_instance_id>", ...}` — instance id no campo event (regressão V2)
3. `{"event": {Chat, Type, IsGroup, IsFromMe, Timestamp, MessageIDs, sender_pn, sender_lid, chatlid}, "EventType": "Delivered", ...}` — event como objeto

V8 resolvia via `payload.instance ?? payload.instance_id ?? pathInstanceId ?? payload.instanceName ?? null`. Falhas:
- `??` aceita string vazia → falsy check posterior dropa silencioso
- Padrão A URLs (`addUrlEvents:true`) tiram instance_id do path → V8 sem âncora
- Padrão B URLs também afetadas (vendor entrega via path que não inclui instance segment em alguns eventos)

Empresa fizermos o filtro Evolution+Uazapi: orgs Evolution não afetadas (provider diferente).

## Impacto

8 orgs com inbound 0 por ~22h:
- Alamaster (parcial — RAFAELLA, FINANCEIRO, CLAUDIO SANTOS — outras instâncias re-pareadas hoje)
- Barulinho Bom (1 instância)
- Brasil Engrenagens (1)
- Mapila Alimentos (2)
- Maria Bonita (1)
- Milennials (3)
- REALSC (2)
- Promove Consórcios (1)

Outbound preservado em todas (egress usa caminho independente).

## Mitigação aplicada

### Patch defensivo (`whatsapp-webhook`)

- `pickInstanceId()` tolerante a 9 aliases + trim/empty check
- `pickUazapiToken()` paralelo pra fallback
- `resolveInstanceByToken()` resolve via `whatsapp_instance_secrets.uazapi_token`
- Log `uazapi_missing_instance` inclui `url_path` + raw payload truncado (2KB)
- Novo log `uazapi_resolved_by_token_fallback` mede taxa do path defensivo

### Rebind direto

Iteração admin token Uazapi pelas 39 instâncias V8-linked. POST `/webhook` com config canônica:
```json
{
  "url": "https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/whatsapp-webhook/<UAZAPI_WEBHOOK_SECRET>",
  "events": ["messages", "messages_update", "connection"],
  "excludeMessages": ["wasSentByApi"],
  "addUrlEvents": true,
  "addUrlTypesMessages": false,
  "enabled": true,
  "action": "update"
}
```
39/39 HTTP 200. Inbound resumido em segundos.

### Backfill

13 history_sync_jobs scope=incremental, max_days=2. Worker pg_cron drena progressivamente. UPSERT preserva idempotência.

## Plano de estabilização (6 componentes — todos deployed)

Ver `[[whatsapp-stability-plan]]` pra detalhe + arquivos.

1. **DLQ inbound** — `whatsapp_webhook_dlq` + `whatsapp-dlq-replay` cron 5min
2. **Watchdog sessão** — `whatsapp_instances.session_dead_since` + `whatsapp-session-watchdog` cron 10min
3. **Health monitor + auto-rebind** — `whatsapp_health_checks` + `whatsapp-health-monitor` cron 5min
4. **Realtime cliente** — heartbeat + reconnect + status badge em ChatHeader
5. **Audit + telemetria** — coluna `received_via` + dashboard `/master/whatsapp-health`
6. **Contract tests** — 14 testes Vitest cobrindo 3 shapes V2

## Commits

| SHA | Mensagem |
|---|---|
| 085d2a93 | fix(whatsapp-webhook): tolerate Uazapi V2 payload schema variations |
| 1263b2e7 | feat: add whatsapp-rebind-webhook to recover from Uazapi webhook drift |
| 3c7e2206 | feat(whatsapp): stability plan components 1-3 |
| 90e5ab7a | feat(whatsapp): stability plan components 4-6 |

Branch: `fix/whatsapp-rebind-webhook`. PR ainda aberto (não mergeado).

## Métricas pós-mitigação

| Métrica | Antes patch | Depois patch |
|---|---|---|
| `uazapi_missing_instance` | 17–68/min | 0/min |
| `uazapi_process` success | 0/min | 19–85/min |
| `uazapi_resolved_by_token_fallback` | (não existia) | ~50% do tráfego |

50% via token fallback = Uazapi V2 mesmo agora não envia `instance` em metade dos payloads. Reforço necessário em qualquer mudança futura no webhook.

## Sessões dead surfaced

6 instâncias `disconnected` com reason `logged out from another device` (não relacionado ao incident — descoberta lateral):

- Comercial 1, mikelli, PROSPECÇAO (REALSC), Comercial (Sayonara), Nicoladeli, JUAN (MONIT)

Precisam re-pair humano via QR. Watchdog agora alerta. Notificação ao dono ainda não implementada (BL-WA-02).

## O que falta

Backlog completo em `[[whatsapp-stability-100pct]]`. Resumo:

- BL-WA-01..03 (4h): fallback polling realtime, notificação dono sessão morta, UI banner
- BL-WA-04..10 (8h): mídia DLQ, grupos, schema snapshot, botões manuais, gráfico drift, Sentry tags, outbound monitor
- BL-WA-11..14 (4h): E2E test, cleanup legado, refactor reconnect, test fake timers

Total ~16h pra fechar ~99%.

## Lições

1. **`??` mata silencioso**: empty string passa pelo nullish coalescing. Toda resolução crítica precisa de `if (!s || !s.trim())` explícito.
2. **HTTP 200 + drop = pior alerta**: sem DLQ ou contagem de drops vs upserts, leak vira invisível por horas. Métricas comparativas (v8 vs vendor) detectam onde logs não detectam.
3. **Vendor schema drift inevitável**: contract tests + snapshot diário viram não-negociáveis quando dependência crítica não tem SLA de payload estável.
4. **Outbound funcional ≠ pipeline saudável**: outbound usa caminho diferente do webhook. Não dá pra inferir health do inbound olhando só o outbound.
