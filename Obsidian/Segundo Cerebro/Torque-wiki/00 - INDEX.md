---
tags:
  - claude-code
  - index
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-14
status: active
---

# Torque CRM - Segundo Cerebro (LLM Wiki)

**Resumo**: Base de conhecimento completa do Torque CRM, organizada para consulta por LLM seguindo o padrao Karpathy LLM Wiki. SaaS B2B multi-tenant para gestao de leads, pipelines e automacoes com IA.

> **Antes de editar qualquer doc**, leia [[CONTRIBUTING]] — politica de doc-as-code, blocos auto-gerados, anti-padroes.

## Navegacao Rapida (Mapas de Conteudo)

| MOC | Escopo |
|-----|--------|
| [[MOC - Arquitetura]] | Stack, decisoes, specs, infraestrutura, seguranca |
| [[MOC - Features]] | Features organizadas por dominio |
| [[MOC - Operacional]] | Setup, troubleshooting, scripts, fluxos de trabalho |
| [[MOC - Agentes]] | Time de 10 agentes especializados e protocolo |
| [[MOC - Diretivas]] | Regras de negocio (camada 1 da arquitetura) |
| [[Glossario]] | Termos, siglas, conceitos-chave |
| [[MOC - Plans]] | Planos de implementacao cronologicos |
| [[MOC - Design Specs]] | Documentos de design tecnico |
| [[MOC - Docs]] | ADRs e guias tecnicos |
| [[MOC - Feature Specs]] | Especificacoes formais de features (SDD) |

## Stack Resumida

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript 5.8 + Vite 5 (SWC) |
| UI | shadcn/ui (Radix) + Tailwind 3 + Lucide icons |
| State | TanStack Query v5 + React Context (auth/features) |
| Backend | Supabase (Postgres + Auth + Edge Functions + Realtime + Storage) |
| AI | Google Gemini (embeddings 1536d) + pgvector (RAG) + OpenRouter |
| Integracoes | Evolution API, Meta, Google Calendar, TinyERP, Asaas, n8n, SZ.Chat |
| Deploy | Docker + EasyPanel (Hostinger VPS) |

## Restricoes Criticas

> [!danger] NAO FAZER
> - **Nunca editar** `src/integrations/supabase/types.ts` manualmente (270KB auto-gerado)
> - **Nunca usar** `--no-verify-jwt` na CLI (use `verify_jwt = false` no config.toml)
> - **Nunca usar** SDR/Closer como role no codigo - roles sao `admin`, `master`, `membro`
> - **Nunca enviar** service_role key no frontend
> - **Nunca editar** migration que ja rodou - sempre criar nova

## Mapa Completo de Notas

### Identidade do Agente
- [[Permissoes]] - MCPs, allow/deny, diretorios acessiveis
- [[Comportamentos]] - Regras de conduta, padroes de qualidade

### Arquitetura
- [[Visao Geral]] - Tipo de projeto, stack, multi-tenancy, design system
- [[Modulos]] - Componentes, hooks, pages, edge functions
- [[Integracoes]] - APIs, servicos externos, fluxos de dados
- [[Arquitetura 3 Camadas]] - Diretivas → Orquestracao → Execucao
- [[Analise Logging SaaS]] - Sistema de logging multi-tenant

### Operacional
- [[Scripts e Comandos]] - Todos os comandos uteis
- [[Fluxos de Trabalho]] - Como executar tarefas comuns
- [[Limitacoes]] - Gotchas, bugs, areas frageis
- [[Supabase Setup]] / [[OpenRouter Setup]] - Configuracoes de infra
- [[Guia Erro 500]] - Troubleshooting RLS

### Decisoes
- [[ADR-2026-04-12-arquitetura-inicial]] - 9 decisoes arquiteturais

### Log de Contexto
- [[2026-04-12-sessao-inicial]] - Primeira varredura do projeto

### Agentes (ver [[MOC - Agentes]])
- [[Protocolo]] - Protocolo de roteamento
- [[Agentes/Conductor]] / [[Agentes/Architect]] / [[Agentes/Backend]] / [[Agentes/Frontend]] / [[Agentes/DBA]] / [[Agentes/QA]] / [[Agentes/Infra]] / [[Agentes/Automation]] / [[Agentes/AI]]

### Features (ver [[MOC - Features]])
Organizadas em: Vendas, Comunicacao, Automacao, IA, Analytics, Equipe, Integracoes, Admin

### Relatorios
- [[Relatorio Abril]] - Qualidade de agentes, sistema, documentacao + roadmap

### Diretivas (ver [[MOC - Diretivas]])
Regras de negocio para processamento de leads, campanhas, webhooks, deploy

### Specs e Design Docs
Documentos de design e planos de implementacao em `07 - Feature Specs/`, `09 - Docs/`, `10 - Plans/`, `11 - Design Specs/`


## Links relacionados

- [[00 - INDEX]]
