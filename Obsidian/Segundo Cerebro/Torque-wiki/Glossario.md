---
tags:
  - torque-crm
  - glossario
  - referencia
created: 2026-04-14
last_updated: 2026-04-14
status: active
---

# Glossario

**Resumo**: Termos-chave do Torque CRM para referencia rapida e consistencia terminologica.

## Roles

- **Master Admin**: Administrador Milennials com bypass total cross-org. Ver [[Master Admin]]
- **Admin**: Administrador de uma organizacao especifica
- **Membro**: Usuario regular de uma org (NUNCA usar "SDR" ou "Closer" no codigo - sao conceitos de UI)

## Pipes Estruturais

- **Pipe WhatsApp**: Primeiro pipe - qualificacao de leads. Ver [[Pipe WhatsApp]]
- **Pipe Confirmacao**: Segundo pipe - confirmacao de reuniao. Ver [[Pipe Confirmacao]]
- **Pipe Propostas**: Terceiro pipe - negociacao e fechamento. Ver [[Pipe Propostas]]

## Conceitos Tecnicos

- **RLS (Row Level Security)**: Isolamento multi-tenant via Postgres policies. Ver [[Permissoes Sistema]]
- **Edge Function**: Funcao serverless Deno no Supabase. Ver [[Modulos]]
- **pgvector**: Extensao Postgres para embeddings (RAG do Copilot). Ver [[Copilot]]
- **pg_cron / pg_net**: Cron jobs no Postgres que disparam edge functions via HTTP. Ver [[ADR-2026-04-12-arquitetura-inicial]]
- **React Query**: TanStack Query v5, camada de server state. Ver [[Visao Geral]]
- **DAG**: Directed Acyclic Graph - modelo do [[Workflow Builder]]

## Integracoes

- **Evolution API**: Wrapper open-source multi-device WhatsApp. Ver [[WhatsApp Evolution]]
- **n8n**: Orquestrador de automacoes externas. Ver [[n8n Orquestracao]]
- **Asaas**: Processador de pagamentos brasileiro. Ver [[Asaas Pagamentos]]
- **TinyERP**: ERP brasileiro para sync de produtos. Ver [[TinyERP]]
- **SZ.Chat**: Chat multi-canal alternativo (Alamaster). Ver [[SZ Chat]]

## Siglas

- **CRM**: Customer Relationship Management
- **ICP**: Ideal Customer Profile
- **MRR**: Monthly Recurring Revenue
- **CPL**: Cost Per Lead
- **CAC**: Customer Acquisition Cost
- **ROAS**: Return On Ad Spend
- **UTM**: Urchin Tracking Module
- **RBAC**: Role-Based Access Control
- **BaaS**: Backend as a Service
- **SDD**: Spec-Driven Development (tlc-spec-driven)

## Links relacionados

- [[00 - INDEX]]
- [[Visao Geral]]
- [[Comportamentos]]
