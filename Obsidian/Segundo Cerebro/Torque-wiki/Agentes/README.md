---
title: Time de Agentes
type: referencia
status: ativo
tags:
  - agente
  - referencia
  - roteamento
updated_at: 2026-04-13
---

# Time de Agentes

9 agentes especializados que operam autonomamente em toda task. O [[Protocolo]] define o fluxo. O Conductor faz a triagem.

## Roster

| Agente | Role | Identidade | Skill |
|--------|------|------------|-------|
| [[Conductor]] | Orquestrador | Cérebro operacional. Triaga, roteia, coordena | `agent-conductor` |
| [[Architect]] | Principal Engineer | Pensa em sistemas, não features. 3 horizontes | `agent-architect` |
| [[Backend]] | Staff Backend | Contratos confiáveis entre sistemas | `agent-backend` |
| [[Frontend]] | Staff Frontend | Experiências, não interfaces. Dark-first | `agent-frontend` |
| [[DBA]] | Senior DBA | PostgreSQL nativo. Paranóico com integridade | `agent-dba` |
| [[QA]] | Senior QA | Encontra o bug que ninguém pensou | `agent-qa` |
| [[Infra]] | Senior Infra | Automação é respirar. Observabilidade é viver | `agent-infra` |
| [[Automation]] | Automation Engineer | n8n, cron, webhooks, event-driven | `agent-automation` |
| [[AI]] | AI/ML Engineer | Copilot, RAG, embeddings, conversations | `agent-ai` |

## Tabela de Roteamento

| Sinal na task | Agente(s) |
|---------------|-----------|
| `supabase/functions/`, endpoint, payload, webhook, API | Backend |
| `src/components/`, `src/pages/`, UI, visual, design, CSS | Frontend |
| `supabase/migrations/`, tabela, index, RLS, SQL, schema | DBA |
| Teste, coverage, verificação, QA, flaky | QA |
| Deploy, Docker, CI/CD, env vars, monitoring, secrets | Infra |
| n8n, cron, automação, workflow trigger, pg_cron, jobs | Automation |
| Copilot, agente IA, RAG, embeddings, conversation, prompt | AI |
| Arquitetura, decisão cross-cutting, trade-off, boundaries | Architect |

## Combinaçoes comuns

| Tipo de task | Sequência |
|--------------|-----------|
| Feature completa nova | Architect → DBA → Backend → Frontend → QA |
| Automação nova | Architect (se decisão) → Automation → Backend → QA |
| Mudança de IA | AI → Backend → Frontend (se UI) → QA |
| Bug de UI | Frontend → QA |
| Bug de API | Backend → QA |
| Performance de query | DBA → Backend → QA |
| Novo pipeline/migration | DBA → Backend → Frontend → QA |
| Deploy/config | Infra |

## Skills transversais

Todos os agentes usam:
- `tlc-spec-driven` - SDD obrigatório em toda task
- Obsidian sync - atualizar vault após execução
- `.specs/` - especificação e documentação de features


## Links relacionados

- [[00 - INDEX]]
- [[MOC - Agentes]]
