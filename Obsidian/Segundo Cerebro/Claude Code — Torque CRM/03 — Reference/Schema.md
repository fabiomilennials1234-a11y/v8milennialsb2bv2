---
type: reference
title: Schema — Tabelas Principais
status: draft
created: 2026-05-15
updated: 2026-05-15
tags: [reference, schema, postgres]
related: ["[[RLS Policies]]", "[[Multi-tenancy]]"]
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

## Copilot (IA)

| Tabela | Função |
|---|---|
| `copilot_agents` | Agentes IA |
| `copilot_agent_faqs` | FAQs com embeddings |
| `copilot_agent_kanban_rules` | Regras de movimentação por stage |
| `conversations` | Conversas com leads |
| `conversation_messages` | Mensagens |
| `channel_messages` | Mensagens multi-canal |
| `agent_decision_logs` | Audit decisões |
| `runtime_logs` | Reasoning chain |

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
  ├── (N) campanhas
  └── (N) ...

leads (1)
  ├── (N) lead_tags ─→ (N) tags
  ├── (N) pipe_whatsapp entries
  ├── (N) pipe_confirmacao entries
  ├── (N) pipe_propostas entries
  ├── (N) custom_pipe_entries
  ├── (N) conversations ─→ (N) conversation_messages
  ├── (N) follow_ups
  └── (FK) responsible / sdr / closer → team_members

copilot_agents (1)
  ├── (N) copilot_agent_faqs
  ├── (N) copilot_agent_kanban_rules
  └── (N) conversations
```

(Visual via mermaid em `docs/architecture/02-containers.md` — TODO F5)

## Conventions

- PK: `id uuid default gen_random_uuid()`
- Tenant: `organization_id uuid not null references organizations(id)`
- Timestamps: `created_at timestamptz not null default now()`, `updated_at timestamptz`
- Soft delete: `deleted_at timestamptz` (algumas tabelas)
- Naming: snake_case
- Foreign keys: explícitas + index obrigatório

## Migration count

322+ migrations em `supabase/migrations/`. Última: ver `git log supabase/migrations/`.
