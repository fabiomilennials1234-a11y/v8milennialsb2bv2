---
type: architecture
title: Áreas Frágeis — Mapa de Risco
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [arquitetura, risco, qualidade]
related: ["[[Visao Geral]]", "[[Copilot]]", "[[whatsapp-stability-plan]]", "[[Permissoes Sistema]]"]
owner: gabriel
---

# Áreas Frágeis — Mapa de Risco

> Diátaxis: **Explanation**. Onde o sistema é mais sensível e por quê.
> Ao tocar nessas áreas, testar com cuidado extra e pedir revisão de Security.

## Severidade

| Nível | Significado | Política |
|---|---|---|
| 🔴 Crítica | Bug aqui = produção quebrada pra muitas orgs | Revisão CTO + testes E2E obrigatórios |
| 🟠 Alta | Bug aqui = feature quebrada pra uso real | Revisão CTO + testes integration |
| 🟡 Média | Bug aqui = experiência ruim mas recuperável | Testes unit + revisão |

## Áreas

### 🔴 Copilot (agentes IA do produto)

**Por que frágil:**
- Fluxo end-to-end longo: lead msg → webhook WhatsApp → agent-message → Gemini
  → DB → outbound → WhatsApp → lead
- Múltiplas fontes de não-determinismo (LLM, retry, race condition)
- God module legado (`agent-engine.ts`) acabou de ser refatorado
  ([[ADR-2026-04-27-refactor-agent-engine-modular]])
- pgvector + embeddings exigem regen quando muda business context

**Onde mora:**
- UI: `src/components/copilot/`, `src/pages/Copilot.tsx`
- Hooks: `src/hooks/useCopilotAgents.ts`
- Backend: `supabase/functions/agent-message/`, `_shared/copilot/`,
  `_shared/ai-action-executor.ts`, `outbound-trigger/`
- Tabelas: `copilot_agents`, `copilot_agent_faqs`, `copilot_agent_kanban_rules`,
  `conversations`, `conversation_messages`, `agent_decision_logs`, `runtime_logs`

**Edge cases sensíveis:**
- Agente sem business_context → respostas genéricas
- Lead sem telefone → não recebe msg
- Conversa sem mensagens prévias → cold start ruim
- Desativar agente → batches em progresso completam (não para imediatamente)
- PDF chunking falha → status "processing" eterno

**Como testar:**
1. Criar agente → configurar (prompt + FAQs + kanban rules + business context)
2. Ativar
3. Mandar msg como lead (WhatsApp real ou simulado)
4. Validar resposta + atualizações no kanban + agent_decision_logs

### 🔴 WhatsApp (Uazapi)

**Por que frágil:**
- Dependência de provider externo (Uazapi) com schema instável
  (incidente 2026-05-14: V2 deploy mudou shape do payload)
- Provider único (sem failover automático)
- Volume de webhooks alto (~3900 msgs/dia em 8 orgs)
- Estado de sessão WhatsApp pode "morrer" silenciosamente
- Migração Evolution → Uazapi recente

**Onde mora:**
- Adapter: `_shared/whatsapp-client.ts` + `_shared/whatsapp-providers/`
- Proxy: `whatsapp-api-proxy/` (JWT + tenant + rate limit)
- Webhook: `whatsapp-webhook/` (secret path)
- History: `history-sync-worker/`
- Mass: `mass-send-{create,status,control}/`
- Frontend: `src/lib/whatsappApi.ts`, `chat/actions/`, `chat/history-sync/`,
  `whatsapp-migration/`, `campaigns/MassSend.tsx`
- Tabelas: `whatsapp_instance_secrets` (RLS deny-all), `history_sync_jobs`,
  `uazapi_sender_jobs`, `whatsapp_webhook_dlq`, `whatsapp_health_checks`
- RPCs: `get/set_uazapi_credentials` (service_role only)

**Mitigações ativas:**
- Patch defensivo no webhook (tolera schema V2)
- DLQ (Dead Letter Queue) + replay cron 5min
- Session watchdog cron 10min
- Health monitor cron 5min
- Banner UI sessão morta (BL-WA-03 ✓)
- Fallback polling realtime (BL-WA-01 ✓)
- Mídia DLQ + retry (BL-WA-04 ✓)
- Group capture (BL-WA-05 ✓)

**Pendências:** ver [[whatsapp-stability-100pct]] (BL-WA-02, 06-14).

**Kill-switch:** `organizations.whatsapp_provider_override`.

### 🟠 Permissões

**Por que frágil:**
- 3 camadas com interação complexa: Master role + Org admin + Feature
  permissions + Role matrix (admin/master/membro)
- Falsos positivos/negativos recorrentes (ex: `move_pipe_record` em
  edição-só-de-data — [[ADR-2026-04-30-meeting-date-sync]])
- Barreira final client-side em alguns paths
  ([[move-pipe-record-server-side]] pendente HIGH)
- Fallback `allowed: true` em `src/lib/permissions.ts`
  ([[permissions-fallback-fail-closed]] pendente MEDIUM)

**Onde mora:**
- Frontend: `src/lib/permissions.ts`, `src/hooks/useUserRole.ts`,
  `useCanPerformAction(action)`, `useMasterAuth()`
- Backend: `_shared/permission_engine.ts`
- Testes: `tests/integration/permission-engine.test.ts`

**Como testar:** com admin / membro / master separadamente. Cada combinação
de role + ação. Edge: usuário com role mudado mid-sessão.

### 🟠 Pipelines e workflows

**Por que frágil:**
- Lead pode estar em múltiplos pipes simultâneo
- Sync entre tabelas: `pipe_confirmacao.meeting_date` ⇄ `leads.compromisso_date`
  ([[ADR-2026-04-30-meeting-date-sync]])
- Triggers de workflow podem duplicar (client + server)
  ([[triggerStageChangedWorkflows-duplicate]] pendente)
- Workflows DAG com cycle detection limitada

**Onde mora:**
- Frontend: `src/pages/PipeWhatsapp.tsx`, `PipeConfirmacao.tsx`,
  `PipePropostas.tsx`, `CustomPipe.tsx`, `WorkflowBuilder.tsx`
- Hooks: `usePipe<Tipo>.ts`, `useWorkflows.ts`
- Backend: `_shared/workflow_engine.ts`, `workflow-trigger/`

### 🟡 Realtime

**Por que frágil:**
- `postgres_changes` retorna só campos alterados, sem joins
- WebSocket pode ficar "joined" sem receber eventos
- Reconnect mechanism tem hack `dispatchEvent`
  ([[whatsapp-stability-100pct]] BL-WA-13)
- Múltiplas tabs do mesmo user podem duplicar subscriptions

**Onde mora:**
- Hooks: `src/hooks/useRealtimeSubscription.ts`,
  `src/hooks/chat/useWhatsAppRealtime.ts`

### 🟡 Cron + pg_net

**Por que frágil:**
- pg_net é Supabase-only (sem fallback se quebrar)
- 10+ jobs/1min — tempestade de net calls
- Auth via `x-cron-secret` (header check manual)
- Silent failure se secret errado

**Onde mora:**
- Migrations: `supabase/migrations/*schedule_*.sql`
- Edge functions invocadas: ver [[Cron Jobs]]

### 🟡 Tipos Supabase auto-gerados

**Por que frágil:**
- `src/integrations/supabase/types.ts` (270KB) auto-gerado
- Edição manual = silent overwrite no próximo regen
- Schema drift entre dev e prod pode gerar tipos diferentes

**Como manter:**
- Regen pós migration: ver [[regenerar-types-supabase]]
- Commitar regen sempre que migration aplicada

## Heurísticas pra trabalho

1. Toque em área crítica → ADR ou changelog explícito
2. Mudança em RLS / migration sensível → `[security]` no commit
3. Refactor em área frágil → cobertura de teste antes de tocar
4. Bug em produção em área frágil → pos-mortem como ADR

## Glossário rápido

- **DLQ** — Dead Letter Queue (mensagens que falharam, esperando replay)
- **RLS** — Row Level Security (policies Postgres)
- **pg_cron** — Cron scheduler dentro do Postgres
- **pg_net** — HTTP client dentro do Postgres
- **Uazapi** — provider WhatsApp atual (substituiu Evolution)
- **kanban rules** — regras de movimentação automática por stage no Copilot
