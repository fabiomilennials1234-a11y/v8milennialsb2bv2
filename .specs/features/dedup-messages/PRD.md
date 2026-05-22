## Problem Statement

Operadores e leads recebem mensagens repetidas no WhatsApp via Torque CRM. Investigação na org Bertin (47 conversas, 9276 msgs em 14 dias) revelou 4 padrões distintos de duplicação:

1. **Triplicação de greeting "fora de horário"** — Copilot (Bia) + 2 disparos manuais (workflow/regra) batem simultâneo. Em 2026-05-08/09 → 1005x cada msg pro phone 5515935004596 em 9h13min (loop bot-to-bot com chatbot imobiliário externo). 158x em 56min pro 553172280540.
2. **Disparo manual repetido 12x exato** — Templates ("Opa <Nome>, tudo bem?", "Oi Filipe!") enviados 12 vezes em 30min via `whatsapp-api-proxy` com 12 message_ids distintos do Uazapi. Padrão 3×3 indica retry sem idempotência ou click duplicado sem debounce.
3. **Bug classificação `sent_source`** — 69 msgs com `raw_payload.track_source='workflow-action'` salvas como `sent_source='manual'` no `whatsapp_messages` → distorce métricas e bloqueia análises.
4. **Workflow re-trigger** — Workflow `c60fd533` (Disparo 1 Qualific.) executou 142x para 78 leads únicos → 7 execuções no mesmo lead. Sem dedup window.

Sem fix: lead percebe spam, instância WhatsApp arrisca ban por padrão anormal, custo LLM/Uazapi inflado, dados ruidosos para análises.

## Solution

Pipeline de envio multi-camada com idempotência atômica, detecção de loop, orquestração unificada de greeting e classificação correta na ingestão:

1. **Dedup atômica** em todo caminho de send (proxy frontend, outbound-sender, copilot followup, workflow action) via tabela com unique constraint + `ON CONFLICT DO NOTHING`. Janela configurável por source.
2. **Detector de loop bot-to-bot** chamado antes de despachar copilot. Marca conversation como `AI_PAUSED_LOOP` quando detecta sinal claro.
3. **Greeting orchestrator** — uma única fonte por janela de horário ganha o direito de disparar greeting "fora de horário" para o lead.
4. **Workflow trigger dedup** — partial unique index em `workflow_executions` impede re-trigger do mesmo (workflow, lead, trigger_event) dentro de janela.
5. **Classifier correto** na ingestão webhook + history sync — `track_source='workflow-action'` vira `sent_source='workflow'`, `sent_by_ai=true`.
6. **Frontend** — debounce + idempotency UUID por click no composer.

## User Stories

1. As an operador, I want o botão de enviar mensagem do composer não disparar requests duplicadas quando clico mais de uma vez rápido, so that o lead não recebe a mesma mensagem 3x.
2. As an operador, I want um feedback visual claro quando o sistema detectar um envio duplicado em janela curta, so that eu entendo por que minha segunda tentativa não foi enviada.
3. As an operador, I want forçar um reenvio legítimo (após erro de rede) passando um override de idempotência, so that eu não fique preso quando precisar reenviar de propósito.
4. As an operador, I want que workflows de greeting "fora de horário" só disparem uma única mensagem por lead por janela de horário, so that o lead não receba 3 greetings duplicados em sequência.
5. As an operador, I want que o copilot pause automaticamente uma conversa quando detectar loop bot-to-bot, so that não consumamos quota de LLM/Uazapi até alguém investigar.
6. As an admin, I want ver no histórico da conversa uma marca clara de "PAUSADO_POR_LOOP" com o evidence (3 msgs idênticas em 60s, etc.), so that eu entendo por que o copilot parou.
7. As an admin, I want métricas separadas de manual, copilot, workflow, mass_send no relatório de envios, so that eu consiga atribuir o volume corretamente.
8. As an admin, I want que workflows não reexecutem para o mesmo lead em janela curta com o mesmo trigger event, so that um lead com stage_changed em sequência não receba spam de mensagens.
9. As a developer, I want um módulo `send-dedup` testável em isolamento com interface estreita, so that eu possa reusar a mesma garantia em qualquer novo caminho de envio sem reimplementar lógica.
10. As a developer, I want um módulo `bot-loop-detector` puro (sem side effect na detecção), so that eu possa testar matriz de sinais com fixtures sem precisar de DB live.
11. As a developer, I want um módulo `greeting-orchestrator` que decida UMA fonte por janela e persista a decisão atomicamente, so that múltiplos triggers competindo não causem disparos paralelos.
12. As a developer, I want um classifier de fonte de mensagem reutilizável em webhook + history-sync, so that não duplicamos lógica de map em dois lugares e divergimos.
13. As a CTO, I want telemetria de `duplicates_blocked` por org/source/dia, so that eu detecte regressões e tendências.
14. As a CTO, I want que a fix seja cirúrgica e não quebre fluxos legítimos de envio (template em massa, follow-up de copilot, mass send), so that não vire incidente em produção.
15. As an analyst, I want backfill opcional do `sent_source` para mensagens históricas usando `raw_payload.track_source`, so that relatórios passados também fiquem consistentes (decisão out of scope desta PRD — flag manual).

## Implementation Decisions

### Módulo 1 — `_shared/send-dedup.ts`

Interface (deep module):

```typescript
type DedupResult =
  | { kind: 'ok'; token: string }
  | { kind: 'duplicate'; firstSentAt: string; ttlSeconds: number };

type SendSource = 'manual' | 'copilot' | 'workflow' | 'mass_send' | 'followup';

export async function tryReserveSend(args: {
  supabase: SupabaseClient;
  orgId: string;
  phone: string;          // normalized E.164
  contentHash: string;    // sha256 of normalized content
  source: SendSource;
  idempotencyKey?: string; // UUID v4 from caller; bypasses content-hash dedup
}): Promise<DedupResult>;
```

- Janela default por source: `manual=10s`, `copilot=60s`, `workflow=300s`, `mass_send=86400s`, `followup=3600s`. Configurável via `org_settings.send_dedup_windows` (jsonb).
- Tabela nova `send_dedup_log(id, org_id, phone, content_hash, source, expires_at, idempotency_key)`:
  - Unique partial `(org_id, phone, content_hash, source) WHERE idempotency_key IS NULL` — combinada com cleanup cron de expirados.
  - Unique `(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL` — retry com mesma key é noop idempotente.
- Atomic via `INSERT ... ON CONFLICT DO NOTHING RETURNING` — race-free.
- Conteúdo normalizado: lowercase, trim, collapse whitespace, strip emoji ZWJ. Hash `sha256` → primeiros 32 chars hex.

### Módulo 2 — `_shared/bot-loop-detector.ts`

```typescript
export async function detectLoop(args: {
  supabase: SupabaseClient;
  orgId: string;
  phone: string;
  lookbackSeconds?: number; // default 120
}): Promise<{
  shouldPause: boolean;
  reason: 'identical_outgoing_burst' | 'inbound_outbound_pingpong' | 'mixed';
  evidence: { count: number; window: string; samples: string[] };
} | null>;
```

- Query `whatsapp_messages` filtrado por org+phone+lookback.
- Sinais (qualquer um aciona):
  - ≥3 outbound com `content_hash` idêntico em <60s.
  - ≥3 trocas inbound→outbound em <5s gap cada e outbound idêntico.
- Função pura — não modifica state. Caller (`agent-engine` + `whatsapp-webhook`) decide pause.
- Enum `ai_state` ganha valor `AI_PAUSED_LOOP` (migration).
- Pause: `UPDATE conversations SET ai_state='AI_PAUSED_LOOP'` + insert `runtime_logs` action `loop_detected`.

### Módulo 3 — `_shared/greeting-orchestrator.ts`

```typescript
type GreetingDecision =
  | { kind: 'dispatch'; source: 'copilot' | 'workflow'; greetingType: string }
  | { kind: 'skip'; reason: 'already_dispatched_in_window' | 'no_active_source' };

export async function resolveGreetingDispatch(args: {
  supabase: SupabaseClient;
  orgId: string;
  agentId: string | null;
  leadId: string;
  phone: string;
  windowId: string;
  preferredSource: 'copilot' | 'workflow';
}): Promise<GreetingDecision>;
```

- Tabela nova `greeting_dispatches(id, org_id, lead_id, phone, window_id, source, greeting_type, dispatched_at)` com unique `(org_id, lead_id, window_id)`.
- Reserva atômica via `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Quem vence dispara, outros recebem `skip`.
- `windowId` derivado de `time-context.ts` (existe) — formato `{behavior_window_id}_{date_bucket}`.
- Hook em `agent-engine` quando decide action greeting + workflow nodes type=greeting.

### Módulo 4 — `_shared/message-classifier.ts` (refactor)

```typescript
export function classifyMessageSource(args: {
  raw_payload: Record<string, unknown>;
  direction: 'incoming' | 'outgoing';
  instance_context: { instance_id: string };
}): {
  sent_source: 'copilot' | 'workflow' | 'manual' | 'mass_send' | 'unknown';
  sent_by_ai: boolean;
};
```

Map decisão (precedência top-down):
- `raw_payload.track_source === 'workflow-action'` → `workflow, true`
- `raw_payload.track_source === 'copilot'` → `copilot, true`
- `raw_payload.track_source === 'mass-send'` → `mass_send, true`
- `raw_payload.source === 'android'` ou `wasSentByApi === false` → `manual, false`
- `raw_payload.track_source === 'whatsapp-api-proxy'` sem outro hint → `manual, false`
- default → `unknown, false`

Aplica em `whatsapp-webhook` (inbound) e `history-sync-worker` (history backfill). Função pura — testável com matriz de fixtures.

### Módulo 5 — Workflow trigger dedup

- Migration: `ALTER TABLE workflow_executions ADD COLUMN trigger_dedup_key text;`
- Partial unique: `(workflow_id, lead_id, trigger_dedup_key) WHERE trigger_dedup_key IS NOT NULL`.
- `workflow-executor.ts` gera key = `${trigger_type}:${sha256(trigger_payload_normalized).slice(0,16)}:${dedup_window_bucket(workflow.dedup_window_seconds)}` antes do insert.
- `workflows.dedup_window_seconds int default 60` — configurável.
- ON CONFLICT no insert → noop, telemetria, não roda nodes.

### Módulo 6 — Frontend send button

- `src/lib/whatsappApi.ts.sendText` aceita opcional `idempotencyKey`. Quando omitido, gera `crypto.randomUUID()`.
- Composer gera key uma vez por click + reset em sucesso/erro.
- Botão `disabled` durante `mutation.isPending`.
- Toast em response 409: "Esta mensagem já foi enviada há X segundos."

### Schema changes

| Tabela | Mudança |
|---|---|
| `send_dedup_log` | nova — dedup atômica |
| `greeting_dispatches` | nova — orquestração greeting |
| `workflow_executions` | + coluna `trigger_dedup_key`, + partial unique index |
| `workflows` | + coluna `dedup_window_seconds default 60` |
| `conversations.ai_state` enum | + `AI_PAUSED_LOOP` |
| `org_settings` | + `send_dedup_windows jsonb default '{}'` |

Todas RLS habilitadas, tenant_isolation policies, índices por `organization_id`.

### API contracts

- `whatsapp-api-proxy` action `sendText`/`sendMedia`/`sendAudio`: payload aceita `idempotency_key` opcional. Response 409 com `{ error, duplicate: true, first_sent_at, ttl_seconds }` quando dedup bloqueia.
- Caller força reenvio passando nova `idempotency_key`.

### Interações chave

- `tryReserveSend` chamado antes de qualquer call ao provider: `whatsapp-api-proxy` (direct send), `outbound-sender` (followup/outbound-trigger/process-outbound-dispatches), `_shared/workflow-executor.ts` (action send_message), `_shared/copilot/dispatcher.ts` (mensagens copilot).
- `detectLoop` chamado: `agent-engine.processMessage` early (antes do LLM); `whatsapp-webhook` antes de enfileirar pro copilot.
- `resolveGreetingDispatch` chamado: `agent-engine` quando `decide-action` retorna ação greeting fora de horário; workflow nodes type=greeting ou out_of_hours_message.
- `classifyMessageSource` chamado: `whatsapp-webhook` no insert de `whatsapp_messages`; `history-sync-worker` no batch insert.

## Testing Decisions

Testes focam comportamento externo observável. Não testam struct interna. Cobertura por módulo:

### `send-dedup` — unit + integration

- Unit `tests/unit/send-dedup.test.ts`:
  - Hash determinístico para conteúdo normalizado (lowercase, whitespace, emoji ZWJ).
  - Janela por source aplica TTL correto.
  - Two calls back-to-back com mesmo content+phone+source dentro da janela → segunda retorna `duplicate`.
  - Mesmo content após expiração → ambas `ok`.
  - `idempotencyKey` igual em duas calls → segunda retorna `ok` com mesmo token (replay idempotente).
- Integration `tests/integration/send-dedup.test.ts`:
  - Race condition — 10 calls concorrentes mesmo content → exatamente 1 `ok`, 9 `duplicate`.
  - RLS — tenant A não vê dedup log de tenant B.
  - Cleanup cron remove rows expirados.

Prior art: `tests/unit/copilot/dispatcher-db.test.ts`, `tests/unit/shared-ai-queue.test.ts`.

### `bot-loop-detector` — unit

`tests/unit/bot-loop-detector.test.ts`:
- Fixture: 3 outbound idênticas em 30s → `shouldPause=true, reason=identical_outgoing_burst`.
- Fixture: 3 outbound diferentes em 30s → `null`.
- Fixture: 5 pares inbound/outbound gap 2s com outbound idêntico → `shouldPause=true, reason=inbound_outbound_pingpong`.
- Fixture: greeting "Oi Filipe!" 1x → `null` (não falso positivo).
- Lookback configurável respeitado.

Prior art: `tests/unit/agent-engine-fallback.test.ts`.

### `greeting-orchestrator` — integration

`tests/integration/greeting-orchestrator.test.ts`:
- 3 callers paralelos pra mesmo `(org, lead, window)` → exatamente 1 `dispatch`, 2 `skip:already_dispatched_in_window`.
- Mesma chamada em window distinta (próximo dia) → `dispatch` de novo.
- `preferredSource` respeitado quando não há conflito.
- Tenant isolation.

### `message-classifier` — unit

`tests/unit/message-classifier.test.ts`:
- Matriz fixtures reais (extraídos de `raw_payload` Bertin):
  - `{track_source:'workflow-action', wasSentByApi:true}` → `workflow, true`
  - `{track_source:'whatsapp-api-proxy', wasSentByApi:true}` → `manual, false`
  - `{track_source:'copilot'}` → `copilot, true`
  - `{source:'android'}` → `manual, false`
  - `{}` (vazio) → `unknown, false`

### `workflow-executor` dedup — integration

`tests/integration/workflow-trigger-dedup.test.ts`:
- 5 calls `executeWorkflow` mesmo lead/trigger payload em <60s → 1 execution, 4 skip.
- Mesmo lead, trigger payload diferente → 5 executions.
- Após janela `dedup_window_seconds` → re-trigger permitido.

Prior art: testes em `tests/integration/` que usam Supabase local + fixtures.

### Princípios

- Não mockar DB nos integration tests (memory `feedback_dev_only`).
- Toda função testada via interface pública.
- Fixtures de `raw_payload` vêm do dataset Bertin (sanitizado).
- Race conditions testadas com `Promise.all` concorrente.

## Out of Scope

- Backfill de `sent_source` para mensagens históricas (decisão manual depois).
- Migração da persistência fragmentada (`whatsapp_messages` vs `conversation_messages` vazio) — separado.
- Idempotency cross-instance multi-org (mesmo phone em orgs diferentes) — não é caso real.
- Mudança de UX do composer além de debounce/idempotency token.
- Tooling de admin para inspecionar `send_dedup_log` (read-only via SQL é suficiente nesta fase).
- Rewriting do cancel gate existente (`isCopilotCanceled`).

## Further Notes

- Convenções do projeto: edge functions Deno, `withSentry`+`withSecurityHeaders`+CORS pattern, RLS em toda tabela com `organization_id`, tests com Vitest, naming snake_case em tabelas, camelCase em código TS.
- Memory relevante: deploy default em dev, prod só com pedido explícito; push em branch nova nomeada.
- Áreas frágeis tocadas: Copilot (`agent-message`) 🔴, WhatsApp (`whatsapp-api-proxy`, `whatsapp-webhook`, `history-sync-worker`) 🔴. Cada PR exige seção Segurança + testes RLS.
- Telemetria nova em `runtime_logs`: `send_dedup_blocked`, `loop_detected`, `greeting_skipped_duplicate`, `workflow_trigger_deduped`, `classify_source_unknown`.
- Ordem de implementação sugerida (cada uma é vertical slice independente):
  1. `send-dedup` + plug em `whatsapp-api-proxy` + frontend idempotency
  2. `message-classifier` + plug em webhook/history-sync
  3. `bot-loop-detector` + integração agent-engine
  4. `greeting-orchestrator` + integração agent-engine/workflow
  5. workflow-executor dedup
- Investigação Bertin: org_id `c187842a-5df1-4f87-9c38-9c5d74d4ac91`, agente Bia `113d6813-5974-48c5-a540-81f269a78ae1`, period 2026-05-11 → 2026-05-22.
