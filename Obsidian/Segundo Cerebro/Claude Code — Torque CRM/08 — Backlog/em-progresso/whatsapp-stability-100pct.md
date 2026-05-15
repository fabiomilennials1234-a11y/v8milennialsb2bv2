---
type: backlog
title: WhatsApp stability — fechar 100%
status: in-progress
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---



# WhatsApp stability — fechar 100%

Backlog dos gaps remanescentes após Fase 1-6 deployed. Estado atual ~82% funcional. Total ~16h trabalho pra ~99% (100% absoluto é ilusão — Uazapi pode mudar schema amanhã).

Cada item abaixo é auto-contido: descrição, arquivos afetados, critério de aceite, esforço, dependências.

## Tracking

- [x] BL-WA-01 — Fallback polling realtime quando channel offline >2min ✓ 2026-05-15
- [ ] BL-WA-02 — Notificação dono sessão morta (push V8 + email)
- [x] BL-WA-03 — UI banner sessão morta nas páginas WhatsApp ✓ 2026-05-15
- [x] BL-WA-04 — Mídia DLQ + retry ✓ 2026-05-15 (code; prod cache pending)
- [x] BL-WA-05 — Captura mensagens de grupo (decisão produto + impl) ✓ 2026-05-15 (D2=A)
- [ ] BL-WA-06 — Schema snapshot diário Uazapi
- [ ] BL-WA-07 — Botão "rebind manual" + "replay DLQ exhausted" no dashboard
- [ ] BL-WA-08 — Gráfico drift histórico no dashboard
- [ ] BL-WA-09 — Sentry tags estruturadas
- [ ] BL-WA-10 — Outbound monitoring dashboard
- [ ] BL-WA-11 — E2E test webhook → DB
- [ ] BL-WA-12 — Cleanup `reconfigure-uazapi-webhooks` legado
- [ ] BL-WA-13 — Refactor reconnect mechanism (remover hack do `dispatchEvent`)
- [ ] BL-WA-14 — Test realtime reconnect com fake timers

---

## BL-WA-01 — Fallback polling realtime
**Esforço**: 1h | **Impacto**: alto | **Dependências**: nenhuma

`useWhatsAppMessagesRealtime` tem heartbeat + reconnect mas se WebSocket fica off `joined` por >2min, frontend continua silencioso. Adicionar fallback `useQuery` com `refetchInterval: 10_000` ativo apenas nesse estado.

**Arquivos**:
- `src/hooks/chat/useWhatsAppRealtime.ts` — expor state stale via store
- `src/hooks/chat/useWhatsAppMessages.ts` — consumir status, ativar `refetchInterval` condicional
- `src/hooks/chat/useWhatsAppContacts.ts` — idem

**Critério aceite**:
- Forçar `supabase.removeChannel()` via DevTools → mensagens novas aparecem em ≤15s via polling
- Status badge mostra "🟡 sincronizando" durante fallback
- Quando channel rejoin, polling para automaticamente

---

## BL-WA-02 — Notificação dono sessão morta
**Esforço**: 2h | **Impacto**: alto | **Dependências**: tabela `notifications` (já existe)

`whatsapp-session-watchdog` detecta dead mas só registra no DB. Adicionar emissão de notificação interna + email pro org_admin.

**Arquivos**:
- `supabase/functions/whatsapp-session-watchdog/index.ts` — após stamp `session_dead_since`, inserir em `notifications` + opcional email via Resend/SES
- Idempotência: evitar notif duplicada por transição (max 1 por dead event)

**Critério aceite**:
- Sessão fica dead → linha em `notifications` aparece pro admin da org em <10min
- Email opcional (feature flag): habilitar via env `WHATSAPP_DEAD_SESSION_EMAIL=true`
- Sessão recovers → notification limpa

---

## BL-WA-03 — UI banner sessão morta
**Esforço**: 1h | **Impacto**: alto | **Dependências**: BL-WA-02 não bloqueia

Banner persistente nas páginas WhatsApp (`/chat`, `/funnel`, kanban) enquanto qualquer instância da org tem `session_dead_since IS NOT NULL`.

**Arquivos**:
- `src/components/whatsapp/SessionDeadBanner.tsx` — novo, query `whatsapp_instances` por org
- Mounting em `src/components/chat/WhatsAppChat.tsx` topo da página
- Mounting em `src/components/chat/ChatShellWithContext.tsx`
- CTA: botão "Reparear agora" → abre modal QR (já existe em `InstanceOwnerModal`)

**Critério aceite**:
- Sessão dead → banner vermelho topo página em <30s (realtime ou polling 30s)
- Click "Reparear" → modal QR abre
- Recovery → banner some

---

## BL-WA-04 — Mídia DLQ + retry
**Esforço**: 3h | **Impacto**: alto | **Dependências**: nenhuma

`persistMediaToStorage` em `whatsapp-webhook/index.ts:121` é fire-and-forget. Quando falha (CDN down, network, storage error) mensagem fica sem mídia. CDN WhatsApp expira ~14d depois — perda permanente.

**Migração nova**:
```sql
CREATE TABLE whatsapp_media_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL,
  instance_id uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  mime_type text,
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error text,
  resolved_at timestamptz,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Arquivos**:
- Migration `*_whatsapp_media_jobs.sql`
- `whatsapp-webhook/index.ts` — em `persistMediaToStorage`, em vez de fire-forget, enfileirar job
- `supabase/functions/whatsapp-media-retry/index.ts` — novo, cron 2min, drain queue, max 5 attempts

**Critério aceite**:
- 100% das mídias ou estão em Storage ou estão em `whatsapp_media_jobs` em retry
- Após 5 attempts → Sentry alert + linha exhausted

---

## BL-WA-05 — Captura mensagens de grupo
**Esforço**: 2h impl + decisão produto | **Impacto**: variável

`whatsapp-webhook/index.ts:400` dropa `@g.us`. Decisão necessária:
- (a) capturar com `is_group:true`, mostrar em tela separada, NÃO criar lead (já não cria)
- (b) capturar + criar lead apenas pra dono do grupo
- (c) ignorar (manter atual)

Barulinho Bom + outras orgs B2B têm grupos críticos. Provável (a).

**Arquivos**:
- Migration: coluna `whatsapp_messages.is_group boolean DEFAULT false`
- `whatsapp-webhook/index.ts` — remover skip, popular `is_group`
- `src/components/chat/` — tab "Grupos" no sidebar de contatos

**Critério aceite**:
- Mensagem de grupo chega → aparece em tab "Grupos"
- Lead não é criado pra membro de grupo
- Toggle preference: org pode optar por NÃO capturar grupos (`organizations.capture_groups`)

---

## BL-WA-06 — Schema snapshot diário Uazapi
**Esforço**: 1h | **Impacto**: médio (proteção futuro)

Cron diário amostra 100 payloads por event_type, persiste em `uazapi_schema_snapshots`. Compara com snapshot anterior → alerta no Sentry se schema mudou.

**Migração**:
```sql
CREATE TABLE uazapi_schema_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  keys jsonb NOT NULL,
  sample_payload jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);
```

**Arquivos**:
- Migration
- `supabase/functions/uazapi-schema-snapshot/index.ts` — cron diário 02:00 UTC
- Lógica: amostrar `runtime_logs` últimas 24h, extrair keys top-level + nested keys de `payload.event`, diff vs último snapshot

**Critério aceite**:
- Snapshot criado todo dia 02:00 UTC
- Adição/remoção de key top-level → Sentry warning
- Mudança de tipo (string → object em campo X) → Sentry critical

---

## BL-WA-07 — Botões manuais no dashboard
**Esforço**: 30min | **Impacto**: médio (UX recovery)

Dashboard `/master/whatsapp-health` ler-only hoje. Adicionar:
- Botão "Rebind agora" por instância → chama `whatsapp-rebind-webhook` scope=instance_ids
- Botão "Replay DLQ" pra linhas exhausted → zera `attempts`, marca como retry

**Arquivos**:
- `src/pages/master/MasterWhatsAppHealth.tsx`
- `src/hooks/useWhatsAppAdminActions.ts` (novo) — mutations via supabase.functions.invoke

**Critério aceite**:
- Click rebind → toast sucesso + próximo health check mostra healthy
- Click replay → linha exhausted volta pra `attempts=0`, próximo cron drena

---

## BL-WA-08 — Gráfico drift histórico
**Esforço**: 1h | **Impacto**: baixo

Sparkline drift últimas 24h por instância (12 pontos, 1 por 2h). `recharts` já tá no projeto.

**Arquivo**: `src/pages/master/MasterWhatsAppHealth.tsx`

**Critério aceite**: linha colorida (verde/amarelo/vermelho) na linha da tabela. Hover mostra timestamp + valor.

---

## BL-WA-09 — Sentry tags estruturadas
**Esforço**: 30min | **Impacto**: médio (debug)

Cada `console.error` ou `logRuntime` em `whatsapp-webhook` deveria carregar `instance_id`, `org_id`, `provider`, `event_type` como Sentry tags.

**Arquivos**:
- `_shared/sentry.ts` — helper `setSentryTagsForWebhook(scope)`
- `whatsapp-webhook/index.ts` — chamar helper após resolveInstance

**Critério aceite**: Sentry issue filtrável por `instance_id:X`.

---

## BL-WA-10 — Outbound monitoring
**Esforço**: 2h | **Impacto**: médio

Hoje outbound (V8 → Uazapi `/send/text`) fica em circuit breaker mas sem dashboard. Adicionar:
- Coluna `whatsapp_messages.send_error text NULL`
- Sender fills error em failed send
- Dashboard card: failed outbound últimas 24h por instância

**Arquivos**:
- Migration coluna
- `_shared/whatsapp-providers/uazapi-provider.ts` — capturar erro + popular
- `src/pages/master/MasterWhatsAppHealth.tsx` — novo card

---

## BL-WA-11 — E2E test webhook → DB
**Esforço**: 2h | **Impacto**: médio

`tests/integration/uazapi-webhook-e2e.test.ts`:
- Cria instância fake + secret
- POST cada um dos 3 shapes V2 contra função local (`supabase functions serve whatsapp-webhook`)
- Asserta upsert em `whatsapp_messages` + idempotência (POST duplicado não cria 2 linhas)

**Dependência**: ambiente integration test rodando (`RUN_BUBBLE_INTEGRATION=true`).

---

## BL-WA-12 — Cleanup `reconfigure-uazapi-webhooks` legado
**Esforço**: 15min | **Impacto**: baixo

`supabase/functions/reconfigure-uazapi-webhooks/` usa config stale (`["messages_from_me"]`, `addUrlEvents:false`). Substituída por `whatsapp-rebind-webhook`. Manter quebra se for chamada.

**Ação**: deletar a função + entry em config.toml + qualquer caller (grep `reconfigure-uazapi-webhooks`).

---

## BL-WA-13 — Refactor reconnect (remover dispatchEvent hack)
**Esforço**: 1h | **Impacto**: baixo (tech debt)

Hoje `useWhatsAppRealtime.ts:scheduleReconnect` faz `window.dispatchEvent(new Event('focus'))` pra forçar re-render. Hacky. Refatorar via `useState` (incrementar key dispara cleanup + reset do useEffect).

**Critério**: reconnect determinístico, sem dependência de event listener externo.

---

## BL-WA-14 — Test realtime reconnect (fake timers)
**Esforço**: 1h | **Impacto**: baixo

Vitest com `vi.useFakeTimers()`:
- Mount hook
- Avançar 30s → assert nenhum reconnect
- Mock channel `lastHeartbeatTs` antigo + avançar 30s → assert reconnect

**Arquivo**: `tests/unit/useWhatsAppRealtime.test.ts`.

---

## Ordem sugerida

Crítico (UX + dados): 01 → 02 → 03 → 04
Importante (operação): 07 → 09 → 10 → 12
Hardening: 11 → 13 → 14 → 06 → 08
Decisão produto: 05 (separado)

Top 3 = 4h. Top 10 = 12h. Total = 16h.
