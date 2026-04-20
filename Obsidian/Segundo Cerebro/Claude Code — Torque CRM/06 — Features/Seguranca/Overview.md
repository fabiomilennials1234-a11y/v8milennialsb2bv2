---
tags:
  - feature
  - seguranca
  - torque-crm
created: 2026-04-15
last_updated: 2026-04-15
owner: agent-security
---

# Seguranca — Overview

## O que e

Dominio transversal de seguranca do Torque CRM. Cobre autenticacao, autorizacao, isolamento multi-tenant, protecao de dados (LGPD), supply chain, integracao segura com servicos externos e resposta a incidentes.

**Owner:** [[agent-security]] — Senior Security Engineer agent. Tem poder de veto em deploys de superficie sensivel.

## Fonte de verdade

- **Threat model + postura:** [.specs/codebase/SECURITY.md](../../../../.specs/codebase/SECURITY.md)
- **Findings operacionais:** [.specs/codebase/CONCERNS.md](../../../../.specs/codebase/CONCERNS.md)
- **Agente:** [.claude/skills/agent-security/SKILL.md](../../../../.claude/skills/agent-security/SKILL.md)
- **ADR:** [[ADR-2026-04-15-agente-security]]

## Escopo

- Auth (JWT, OAuth, session handling)
- Permissoes (RBAC, RLS, permission engine)
- Multi-tenancy (isolamento por `organization_id`)
- Secrets management e rotacao
- Webhook signature (HMAC)
- Supply chain (deps, SBOM)
- LGPD (PII, retencao, direito ao esquecimento)
- LLM security (prompt injection no Copilot)
- Incident response

## Superficie critica

| Area | Localizacao | Risco |
|------|-------------|-------|
| Edge functions publicas | `supabase/config.toml` (49 funcoes com `verify_jwt = false`) | Critico |
| Permission engine | `src/lib/permissions.ts`, `supabase/functions/_shared/permission_engine.ts` | Critico |
| Webhooks | `lead-webhook`, `asaas-webhook`, `meta-*`, `cal-webhook` | Alto |
| Master admin | `master_users` table, `useMasterAuth` | Alto |
| Service_role usage | Todas as edge functions que fazem admin-ops | Alto |
| Secrets | `.env`, `.env.development`, env vars Supabase | Critico |

## Notas relacionadas

- [[Threat Model STRIDE]] — modelo de ameacas por dominio
- [[LGPD Mapeamento PII]] — bases legais e retencao
- [[Secrets e Rotacao]] — schedule de rotacao
- [[Incident Response]] — playbook
- [[RLS Audit]] — auditoria de policies
- [[Permissoes Sistema]] — permissoes do produto (feature)
