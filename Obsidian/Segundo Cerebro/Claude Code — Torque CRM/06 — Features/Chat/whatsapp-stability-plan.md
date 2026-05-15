---
tags:
  - chat
  - whatsapp
  - uazapi
  - stability
  - claude-code
  - incident
created: 2026-05-15
status: in-progress
related:
  - "[[INCIDENT_2026_05_14_UAZAPI_V2]]"
  - "[[WHATSAPP_STABILITY_PLAN]]"
---

# WhatsApp Stability — estado consolidado

Estado atual do plano de estabilização do pipeline WhatsApp (Uazapi → V8 webhook → DB → UI). Gerado após resolução do incidente Uazapi V2 schema change (2026-05-14).

**Doc primário no repo**: `docs/WHATSAPP_STABILITY_PLAN.md`
**Doc incidente**: `docs/INCIDENT_2026_05_14_UAZAPI_V2.md`
**Branch**: `fix/whatsapp-rebind-webhook`

## Funcionalidade hoje — ~82% (B2B típico)

Quebra honesta por dimensão. Veja seção "gaps abertos" pra restante.

| Dimensão | % | Notas |
|---|---|---|
| Inbound text 1:1 | 99% | Patch defensivo + DLQ |
| Outbound text | 95% | Sem dashboard de falhas |
| Outbound do celular do dono | 95% | `wasSentByApi` filtra eco, badge UI ausente |
| Realtime UI | 80% | Heartbeat + reconnect ok, fallback polling falta |
| Mídia | 70% | `persistMediaToStorage` fire-and-forget, sem retry |
| Grupos | 0% | Dropados intencional na linha 400 de `whatsapp-webhook` |
| Reactions / edit / pin / delete | ~60% | Handler existe, sem teste |
| Multi-atendente concorrente | 70% | Realtime ok, sem typing indicator humano |
| AI + handoff humano | 85% | Race condition rara |
| Visibilidade falhas | 60% | Dashboard `/master/whatsapp-health` ok, falta notificação ativa |
| Recovery sessão morta | 30% | Watchdog detecta, sem notificação dono nem UI banner |
| Cobertura teste | 50% | Helpers Uazapi V2 ok, E2E ausente |

## Plano (6 componentes — TODOS deployed em prod)

### 1. Dead Letter Queue inbound — DONE

Webhook agora persiste eventos que falham resolução em `whatsapp_webhook_dlq` em vez de drop silencioso. Replay edge function (cron 5min) reattempts. UPSERT preserva idempotência. 5 tentativas → Sentry + manual review.

**Artefatos**:
- `supabase/migrations/20261012000000_whatsapp_webhook_dlq.sql`
- `supabase/migrations/20261012000001_schedule_whatsapp_dlq_replay.sql`
- `supabase/functions/whatsapp-dlq-replay/index.ts`
- patch em `supabase/functions/whatsapp-webhook/index.ts` (helper `enqueueDlq`)
- `cron.job.whatsapp_dlq_replay` (`*/5 * * * *`, active)

### 2. Watchdog sessão WhatsApp — PARCIAL

Cron 10min compara Uazapi `/instance/all` vs DB. Stamps `whatsapp_instances.session_dead_since` em transições.

**Artefatos**:
- `supabase/migrations/20261012000002_whatsapp_session_dead_since.sql`
- `supabase/migrations/20261012000003_schedule_whatsapp_session_watchdog.sql`
- `supabase/functions/whatsapp-session-watchdog/index.ts`
- `cron.job.whatsapp_session_watchdog` (`*/10 * * * *`, active)

**O que FALTA pra fechar**:
- Notificação dono (push V8 + email) quando watchdog detecta dead
- UI banner persistente nas páginas WhatsApp/chat enquanto `session_dead_since IS NOT NULL`

### 3. Health monitor + auto-rebind — DONE

Drift = `v8_inbound_1h / uazapi_inbound_1h` por instância connected. <0.5 → auto-rebind (cooldown 30min). <0.9 → warning.

**Artefatos**:
- `supabase/migrations/20261012000004_whatsapp_health_checks.sql`
- `supabase/migrations/20261012000005_schedule_whatsapp_health_monitor.sql`
- `supabase/functions/whatsapp-health-monitor/index.ts`
- `cron.job.whatsapp_health_monitor` (`*/5 * * * *`, active)

### 4. Realtime cliente robusto — PARCIAL

Heartbeat 30s + reconnect on stale + visibility/online listeners + status badge.

**Artefatos**:
- `src/lib/realtimeStatusStore.ts` (pub/sub módulo)
- `src/hooks/useRealtimeChannelStatus.ts` (consumer hook via `useSyncExternalStore`)
- `src/hooks/chat/useWhatsAppRealtime.ts` (modificado)
- `src/components/chat/RealtimeStatusBadge.tsx`
- `src/components/chat/view/ChatHeader.tsx` (renderiza badge)

**O que FALTA pra fechar**:
- Fallback polling: quando channel state off `joined` >2min, usar `useQuery` com `refetchInterval: 10s`
- Mecanismo de reconnect atual usa `dispatchEvent('focus')` — hacky, refazer via state/key trigger
- Test de reconnect (Vitest + fake timers)

### 5. Audit + telemetria — PARCIAL

Coluna `whatsapp_messages.received_via` (`webhook` default, `history_sync`, `dlq_replay`, `manual_replay`). Dashboard `/master/whatsapp-health`.

**Artefatos**:
- `supabase/migrations/20261012000006_whatsapp_messages_received_via.sql`
- `src/pages/master/MasterWhatsAppHealth.tsx`
- `src/components/master/MasterSidebar.tsx` (item "WhatsApp Health")
- `src/App.tsx` (rota `/master/whatsapp-health`)
- `supabase/functions/history-sync-worker/index.ts` (set `received_via='history_sync'`)
- `supabase/functions/whatsapp-webhook/index.ts` (lê `x-replay-source` header)

**O que FALTA pra fechar**:
- Botão "rebind manual" por instância no dashboard
- Botão "replay DLQ exhausted" no dashboard
- Gráfico drift histórico (timeseries 24h)
- Sentry tags estruturadas (`instance_id`, `org_id`, `provider`, `event_type`)

### 6. Contract tests Uazapi V2 — PARCIAL

14 testes cobrindo `pickInstanceId` / `pickUazapiToken` contra os 3 payload shapes V2 observados.

**Artefatos**:
- `tests/unit/uazapi-payload-resolution.test.ts`

**O que FALTA pra fechar**:
- E2E webhook → DB (POST com payload V2 → assert upsert + idempotência)
- Schema snapshot diário (cron amostrando 100 payloads/event_type + diffando contra ref)

## Gaps fora do plano original (impacto real)

### A. Mídia DLQ + retry — NÃO IMPLEMENTADO

`persistMediaToStorage` em `whatsapp-webhook` é fire-and-forget. ~10-30% mídias falham silenciosas (estimativa). CDN WhatsApp expira em ~14 dias.

**Fix**: tabela `whatsapp_media_jobs` + cron retry + alert quando >5 attempts.

### B. Mensagens de grupo — NÃO IMPLEMENTADO

`whatsapp-webhook/index.ts:400`: `if @g.us → skip`. Barulinho Bom tem grupo crítico ativo (`THAIS BARULHINHO CHIPS`). Decisão de produto necessária.

**Fix**: capturar com `is_group:true` + tela separada de grupos.

### C. Outbound monitoring — NÃO IMPLEMENTADO

V8 → Uazapi `/send/text` falhas silenciosas. Circuit breaker existe mas sem dashboard.

**Fix**: log estruturado por falha + card no dashboard mostrando taxa.

## Backlog priorizado pra fechar 100%

Ver `[[whatsapp-stability-100pct]]` no backlog em-progresso.

## Decisões registradas

- **Padrão webhook canônico**: `addUrlEvents:true`, URL=`/SECRET` (sem instance_id no path), `excludeMessages:["wasSentByApi"]`, events: `messages, messages_update, connection`. Definido em `UazapiProvider.reconfigureWebhook`. Não mexer sem teste regressivo.
- **Resolução defensiva**: cadeia `instance → instance_id → instanceId → InstanceId → InstanceID → instanceID → pathInstanceId → instanceName → InstanceName`. String vazia tratada como ausente. Fallback final por `uazapi_token`.
- **DLQ retention**: 5 attempts. Após exhausted, ficam no DB pra audit; não auto-deletados.
- **Auto-rebind cooldown**: 30min/instance. Evita rebind loop em caso de problema persistente.
- **Group messages**: dropados (decisão atual, B documenta reversão).
