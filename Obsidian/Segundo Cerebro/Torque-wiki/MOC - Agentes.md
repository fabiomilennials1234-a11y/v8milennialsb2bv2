---
tags:
  - torque-crm
  - moc
  - agentes
created: 2026-04-14
last_updated: 2026-04-15
status: active
---

# MOC - Agentes

**Resumo**: Time de 10 agentes especializados que operam o desenvolvimento do Torque CRM. Cada agente com identidade, dominio, regras e skills.

## Protocolo

- [[Protocolo]] - Protocolo de comunicacao e roteamento entre agentes

## Time de Agentes

| Agente | Nota | Papel |
|--------|------|-------|
| Conductor | [[Agentes/Conductor]] | Triagem e roteamento de tasks (9.0/10) |
| Architect | [[Agentes/Architect]] | Decisoes arquiteturais, 3 horizontes (8.5/10) |
| Backend | [[Agentes/Backend]] | Edge functions, RLS, resiliencia (9.0/10) |
| Frontend | [[Agentes/Frontend]] | UI/UX, dark-first, performance (8.5/10) |
| DBA | [[Agentes/DBA]] | Postgres, queries, migrations (9.0/10) |
| QA | [[Agentes/QA]] | Testes, cobertura, qualidade (8.0/10) |
| Infra | [[Agentes/Infra]] | Deploy, Docker, EasyPanel (8.0/10) |
| Automation | [[Agentes/Automation]] | Workflows, cron jobs, n8n (8.5/10) |
| AI | [[Agentes/AI]] | Copilot, RAG, embeddings (7.0/10 - fragil) |
| Security | [[Agentes/Security]] | Threat model, RLS review, SAST/SCA, LGPD. Poder de veto (novo — 2026-04-15) |

## Avaliacoes

- [[Relatorio Abril]] - Relatorio de qualidade completo (abril 2026)

## Lacunas Identificadas

1. ~~**Security** - Sem agente dedicado~~ — **resolvido em 2026-04-15** ([[Agentes/Security]])
2. **Design System** - Diluido em Frontend, sem documento central
3. **DevRel/Onboarding** - Sem guia para novos devs

## Links relacionados

- [[MOC - Agentes]]

- [[00 - INDEX]]
- [[Comportamentos]]
- [[Permissoes]]
