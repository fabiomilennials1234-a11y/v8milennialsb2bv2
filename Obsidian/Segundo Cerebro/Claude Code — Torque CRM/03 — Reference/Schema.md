---
type: reference
title: Schema — Tabelas Principais
status: draft
created: 2026-05-15
updated: 2026-06-30
tags: [reference, schema, postgres, pgvector, copilot-v2, meta, unit-economics, observability]
related: ["[[RLS Policies]]", "[[Multi-tenancy]]", "[[Edge Functions]]", "[[Cron Jobs]]", "[[RPCs]]"]
owner: gabriel
---

# Schema — Tabelas Principais

> Schema completo (270KB) em `src/integrations/supabase/types.ts` (auto-gerado).
> Não editar manualmente. Regen via [[regenerar-types-supabase]].
> Este doc lista as **principais** tabelas e relações pra navegação rápida.

## Tenant + Auth

| Tabela | Função |
|---|---|
| `organizations` | Tenant central |
| `organization_members` | user ↔ org (role: admin/master/membro) |
| `organization_settings` | Config por org |
| `team_members` | Vendedores + comissões (subset de members) |
| `subscription_plans` | Planos de assinatura |

## Lead lifecycle

| Tabela | Função |
|---|---|
| `leads` | Central — todos os leads |
| `lead_tags` | Tags many-to-many |
| `tags` | Lookup tags |
| `lead_history` | Audit trail |
| `follow_ups` | Tarefas de follow-up |

## Pipelines

| Tabela | Função |
|---|---|
| `pipe_whatsapp` | Funil qualificação (novo → agendado) |
| `pipe_confirmacao` | Funil confirmação (D-5 → compareceu) |
| `pipe_propostas` | Funil propostas (enviada → vendido/perdido) |
| `custom_pipelines` | Funis customizados por org |
| `custom_pipe_entries` | Entries dos funis customizados |
| `pipeline_stages` | Stages dinâmicas |

## Workflows + Campanhas

| Tabela | Função |
|---|---|
| `workflows` | DAG definition |
| `workflow_executions` | Runs |
| `campanhas` | Campanhas temporárias |
| `campanha_stages` | Stages da campanha |

## Copilot v1 (IA)

| Tabela | Função |
|---|---|
| `copilot_agents` | Agentes IA |
| `copilot_agent_faqs` | FAQs com embeddings |
| `copilot_agent_kanban_rules` | Regras de movimentação por stage |
| `conversations` | Conversas com leads |
| `conversation_messages` | Mensagens |
| `channel_messages` | Mensagens multi-canal |
| `agent_decision_logs` | Audit decisões |
| `runtime_logs` | Reasoning chain (ver [[#Observability]]) |

### `copilot_agents` — colunas de prompt (redesign)

`20260605000001_copilot_prompt_redesign.sql` adicionou 3 colunas que sustentam o
storage do prompt em 3 lugares (ver [[Áreas Frágeis]] / nota Copilot v1):

| Coluna | Tipo | Função |
|---|---|---|
| `objective_composite` | `jsonb` (default `NULL`) | Objetivo estruturado em 3 partes: `mission` (o que fazer), `success_criteria` (quando deu certo), `limits` (o que não fazer). Migration backfilla a partir de `main_objective`. |
| `custom_instructions` | `text` (default `NULL`) | Instruções personalizadas do usuário, anexadas ao fim do system prompt. |
| `prompt_hash` | `text` (default `NULL`) | Hash dos campos que afetam o prompt — detecta quando o cache (`system_prompt`) precisa ser regenerado. Setar `NULL` força rebuild. |

> Editar prompt durável via SQL exige tocar os 3 lugares (`system_prompt` +
> `custom_instructions.dos` + `conversation_style.promptSections`) e zerar
> `prompt_hash`. Ver `reference_copilot_v1_prompt_storage`.

## Copilot v2 (rebuild isolado)

Rebuild isolado/inerte do runtime de agentes (arquetípico, fila + worker, tracing).
Tabelas criadas em `20260531174908_copilot_v2_foundation.sql` (foundation) +
`20260531214954_copilot_v2_slices_4_6_7_tables.sql` (slices 4/6/7). RPCs de claim
da fila em `20260601015114_copilot_v2_queue_claim_rpcs.sql`; worker agendado em
`20260601020907_schedule_copilot_v2_worker.sql`.

**14 tabelas `copilot_v2_*`** (todas RLS-on; tabelas internas = `service_role` only,
sem policy `authenticated`):

| Tabela | Função |
|---|---|
| `copilot_v2_agents` | Agente v2 (arquétipo + model_id) |
| `copilot_v2_config` | Config 1:1 do agente (escape hatch, etc.) |
| `copilot_v2_message_queue` | Fila de mensagens inbound (status + retry) |
| `copilot_v2_dlq` | Dead-letter queue da fila |
| `copilot_v2_dedup_locks` | Locks de deduplicação (TTL `expires_at`) |
| `copilot_v2_pause_state` | Pausa humana por telefone canônico |
| `copilot_v2_turn_counters` | Contador de turnos por conversa |
| `copilot_v2_traces` | Trace de execução (1 por turn) |
| `copilot_v2_trace_steps` | Passos do trace (reasoning/tool) |
| `copilot_v2_rubric` | Rubrica de avaliação |
| `copilot_v2_send_media` | Outbox de mídia |
| `copilot_v2_agent_media` | Mídia do agente (`service_role` only) |
| `copilot_v2_knowledge` | Base de conhecimento org-level |
| `copilot_v2_knowledge_chunks` | Chunks RAG (`embedding vector(1536)`, ver [[#Vector / RAG (pgvector)]]) |

**Enums**:
- `copilot_v2_archetype` — `qualificador` \| `vendedor` \| `carteira`
- `copilot_v2_model_id` — default `google/gemini-2.5-flash`
- `copilot_v2_queue_status` — `pending` \| `processing` \| `processed` \| `retry` \| `dead`

**RPCs internas** (`revoke all from public/anon/authenticated`): `copilot_v2_acquire_dedup_lock`,
`copilot_v2_enqueue_message`, `copilot_v2_check_human_pause`, `copilot_v2_set_human_pause`,
`copilot_v2_next_turn`.

> Arquitetura v1 vs v2 e armadilha `finalized_at`: ver `reference_copilot_v1_v2_architecture`.

## Vector / RAG (pgvector)

pgvector habilitado via `extensions.vector`. Embeddings **1536d** (Gemini), busca
semântica por cosseno com índice **HNSW** (`vector_cosine_ops`).

| Tabela / Coluna | Migration | Detalhe |
|---|---|---|
| `copilot_agent_document_chunks` | `20260626000006_pgvector_rag_embeddings.sql` | `embedding extensions.vector(1536)` + HNSW `idx_doc_chunks_embedding`; chunks de documentos por agente/org. RLS: `org_members_select_doc_chunks` + `service_role_all_doc_chunks`. |
| `faqs.embedding` | `20260626000006` | `ADD COLUMN embedding extensions.vector(1536)` + HNSW `idx_faqs_embedding`. |
| `lead_memories` | `20260626000008_lead_long_term_memory.sql` | Memória de longo prazo do lead. `memory_type` ∈ `fact`/`preference`/`pain_point`/`objection`/`context`; `embedding vector(1536)` + HNSW. RLS: `org_members_select_lead_memories` + `service_role_all_lead_memories`. Fallback sem-coluna-vector se pgvector ausente. |
| `copilot_v2_knowledge_chunks` | `20260531214954` | `embedding vector(1536)` (slice 7). |

**RPCs de busca** (`SECURITY DEFINER`): `match_document_chunks(query_embedding vector(1536), …)`,
`match_faqs(query_embedding vector(1536), …)`, `match_lead_memories(query_embedding vector(1536), …)` —
todas retornam `similarity = 1 - (embedding <=> query_embedding)` com `similarity_threshold`.

## Meeting events (event-sourcing)

`20261125000000_meeting_events.sql` — métricas de reunião event-sourced ([[ADR-0007]]).
Eventos imutáveis capturados no booking/held, agnósticos de funil. Atribuição =
snapshot do Pré-vendas canônico do lead no momento do evento.

| Coluna | Detalhe |
|---|---|
| `event_type` | `meeting_booked` \| `meeting_held` (CHECK) |
| `booked_event_id` | self-ref `meeting_events(id)` ON DELETE SET NULL (liga `held` ao `booked`) |
| `pre_sale_responsible_id` | snapshot **sem FK** — team member deletado não reescreve histórico |
| `meeting_date` | data agendada da reunião |
| `occurred_at` | quando o evento ocorreu (default `now()`) |
| `source` / `source_entry_id` | origem (`pipeline` default) + entry de origem |
| `metadata` | `jsonb` default `{}` |

Índices por `(organization_id, event_type, occurred_at)`, `(…, meeting_date)`, `(lead_id, event_type, occurred_at DESC)`, `(organization_id, pre_sale_responsible_id)`.
RLS: `meeting_events_select` (tenant); `GRANT SELECT` a `authenticated`, `ALL` a `service_role`.

**Regra de reschedule** (CONTEXT.md): mesma reunião mantém 1 `booked`; só um shift de
`meeting_date` > 30 dias cria novo `booked`. `booked` que já tem `held` ligado está
fechado — booking posterior sempre conta como novo. Analytics RPCs sobre a tabela em
`20261125000002_analytics_rpcs_meeting_events.sql`.

## Meta integration (Conversions API)

`20261128000003_meta_asset_bindings.sql` — binding de assets Meta + ledger de
idempotência pra envio de Lead Conversion Signals.

| Tabela / Coluna | Detalhe |
|---|---|
| `meta_asset_bindings` | org → `{ page \| ad_account }`. `asset_type` ∈ `page`/`ad_account`; `asset_id`; `asset_name`; `dataset_id` (ad_account only — alvo do Conversions API); `status` (default `active`); `last_polled_at` (page only); `last_error`. Unique `(asset_type, asset_id)`. RLS `tenant_isolation_select` (membros leem as próprias, sem write `authenticated`). |
| `leads.meta_lead_id` | `ADD COLUMN … text` — join key indexado (`idx_leads_meta_lead_id WHERE NOT NULL`) pro Lead Conversion Signal. Populado forward pelo poller (slice 4); sem backfill. |
| `meta_signals_sent` | Ledger de idempotência: cada `event_name` no máximo 1x/lead. `event_name` ∈ `qualified`/`meeting`/`sold`; unique `(lead_id, event_name)`. |

Relacionadas: `20261128000006_meta_pending_conversion_signals_rpc.sql` (RPC de pending),
`20261128000008_meta_pending_signals_auto_dataset.sql` (auto-dataset).

## Unit economics (master-only)

Pressupostos editáveis que o **operador da plataforma (master)** digita pra simular
CAC/Payback por org — **não** são dados do tenant. RLS gateada em `is_master_user()`
(master não tem `team_members`), **deny-all** pra qualquer não-master.

| Tabela / Coluna | Migration | Detalhe |
|---|---|---|
| `org_unit_economics_inputs` | `20270101000000_org_unit_economics_inputs.sql` | Pressupostos por org+cenário. Cenário `base` (custos reais) vs `projecao` (what-if: master sobrescreve `meta_num_vendas` / `meta_ticket_medio`). RLS `master_select_all_org_unit_economics_inputs` + `master_all_…` (USING + WITH CHECK `is_master_user()`). |
| `org_unit_economics_inputs.comissao_pct` | `20270101000300_org_unit_economics_comissao.sql` | `ADD COLUMN numeric(6,3) NOT NULL DEFAULT 0`. `comissaoValor = comissao_pct/100 * faturamento` entra na soma do CAC (comissão neutra). |

**RPCs master-scoped** (`SECURITY DEFINER`, search_path pinado `public, extensions`):
- `master_get_org_sales_summary` (`20270101000100`) — `num_vendas` / `ticket_medio` / `receita_total` reais de uma org arbitrária num período.
- `master_org_sales_cohort` (`20270101000200`) — espelha `get_funnel_health.stages.compraram` (coorte por `created_at`), alinhando a aba **Dados** do Insights com a aba **Saúde**.

> Contexto da feature `/insights`: `project_master_insights_unit_economics`.

## Observability

| Tabela | Migration | TTL / retenção |
|---|---|---|
| `runtime_logs` | `20260728000000_create_runtime_logs.sql` | Originalmente cron `cleanup_runtime_logs_90d` (diário 03:00 UTC, > 90 dias). **Superado** por `20261231000000_schedule_runtime_logs_purge.sql` → `purge-runtime-logs-2d` (diário, mantém só 2 dias; volume baixo, autovacuum reaproveita espaço). |
| `usage_events` | `20260729000000_create_usage_events.sql` | cron `cleanup_usage_events_180d` (diário 04:00 UTC, > 180 dias). `service_role` acesso total (Edge Functions + cron). |

> Ambos os schedules são guardados por `IF pg_cron disponível` (no-op em DB local sem a extensão).

## Avaliação automática (LLM-as-judge)

`20260626000007_llm_as_judge_evaluations.sql` — avaliação automática de qualidade das
respostas do agente.

| Tabela `copilot_conversation_evaluations` | Detalhe |
|---|---|
| `score_relevance`, `score_tone`, `score_goal_align`, `score_conciseness`, `score_overall` | `numeric(3,1)` CHECK `BETWEEN 0 AND 10` |
| `model_used` | `text` default `google/gemini-2.0-flash-001` |

RLS: `org_members_select_evaluations` (leitura tenant) + `service_role_all_evaluations`.

## WhatsApp infraestrutura

| Tabela | Função |
|---|---|
| `whatsapp_instances` | Instâncias Uazapi |
| `whatsapp_instance_secrets` | Tokens (RLS deny-all) |
| `whatsapp_webhook_dlq` | Dead letter queue |
| `whatsapp_health_checks` | Health monitoring |
| `whatsapp_messages_received_via` | Tracking origin (webhook / history-sync / etc.) |
| `history_sync_jobs` | Jobs de backfill |
| `uazapi_sender_jobs` | Mass send jobs |

## Outras

| Tabela | Função |
|---|---|
| `products` | Catálogo B2B (MRR/projeto/unitário) |
| `webhook_deliveries` | Outgoing webhooks com retry |
| `master_audit_log` | Audit de ações master |

## Relações principais

```
organizations (1)
  ├── (N) organization_members
  ├── (N) team_members
  ├── (N) leads
  ├── (N) custom_pipelines
  ├── (N) copilot_agents
  ├── (N) copilot_v2_agents
  ├── (N) meeting_events
  ├── (N) meta_asset_bindings
  ├── (N) org_unit_economics_inputs   (master-only)
  ├── (N) campanhas
  └── (N) ...

leads (1)
  ├── (N) lead_tags ─→ (N) tags
  ├── (N) pipe_whatsapp entries
  ├── (N) pipe_confirmacao entries
  ├── (N) pipe_propostas entries
  ├── (N) custom_pipe_entries
  ├── (N) conversations ─→ (N) conversation_messages
  ├── (N) lead_memories           (RAG, embedding 1536d)
  ├── (N) meeting_events
  ├── (N) meta_signals_sent       (ledger 1x/event_name)
  ├── (N) follow_ups
  ├── (FK) meta_lead_id           (join key Conversions API)
  └── (FK) responsible / sdr / closer → team_members

copilot_agents (1)
  ├── (N) copilot_agent_faqs       (embedding 1536d)
  ├── (N) copilot_agent_document_chunks  (RAG 1536d)
  ├── (N) copilot_agent_kanban_rules
  ├── (N) copilot_conversation_evaluations
  └── (N) conversations

copilot_v2_agents (1)
  ├── (1) copilot_v2_config
  ├── (N) copilot_v2_traces ─→ (N) copilot_v2_trace_steps
  └── (N) copilot_v2_message_queue ─→ copilot_v2_dlq
```

(Visual via mermaid em `docs/architecture/02-containers.md` — TODO F5)

## Conventions

- PK: `id uuid default gen_random_uuid()`
- Tenant: `organization_id uuid not null references organizations(id)`
- Timestamps: `created_at timestamptz not null default now()`, `updated_at timestamptz`
- Soft delete: `deleted_at timestamptz` (algumas tabelas)
- Naming: snake_case
- Foreign keys: explícitas + index obrigatório
- Embeddings: `vector(1536)` (Gemini) + índice HNSW `vector_cosine_ops`
- Tabelas master-only: RLS gateada em `is_master_user()`, deny-all pro resto
- Snapshots de atribuição (ex.: `meeting_events.pre_sale_responsible_id`): **sem FK** de propósito

## Migration count

322+ migrations em `supabase/migrations/`. Última: ver `git log supabase/migrations/`.
