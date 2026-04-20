---
tags:
  - adr
  - agentes
  - seguranca
  - torque-crm
date: 2026-04-15
status: aprovado
---

# ADR — Adicao do Agente Security ao Time

## Status

**Aprovado** — 2026-04-15 pelo CTO (Gabriel)

## Contexto

O time de agentes autonomos do Torque CRM ate 2026-04-14 tinha 9 agentes: Conductor, Architect, Backend, Frontend, DBA, QA, Infra, Automation, AI. Seguranca era responsabilidade diluida entre Infra, Backend e DBA — sem dono claro, sem threat model vivo, sem poder de veto.

Pre-analise do codebase identificou superficie critica nao tratada:

- 49 edge functions com `verify_jwt = false` sem linter/teste que imponha `validateAuth()` interno
- 131+ migrations com 20+ refixes de RLS — isolamento multi-tenant tratado reativamente
- Rate limit em memoria + fallback `allowed: true` no permission engine
- `rls-org-isolation.test.ts` skipado em CI
- 7 integracoes externas (Asaas, Evolution, Gemini, Google, TinyERP, Meta, SZ.Chat) sem rotacao de secrets
- LGPD sem mapeamento formal de PII nem direito ao esquecimento
- Risco de prompt injection no Copilot cross-org

Com ~30 orgs e crescendo, time com CTO + dev junior, e alvo de ser enterprise-ready: o custo de um incidente de seguranca superaria de longe o custo operacional de ter um agente dedicado.

## Decisao

Criar o agente **Security — Senior Security Engineer** (`agent-security`).

**Dominio:** SAST, SCA, secrets scanning, IaC scanning, threat modeling (STRIDE), RLS review, auth hardening, webhook HMAC, LGPD, supply chain, incident response, LLM security.

**Poder de veto:** pode bloquear merge/deploy quando:
- SAST, SCA ou secrets scan falham em CI
- RLS policy nova sem teste pgTAP
- Edge function publica sem `validateAuth()` testado
- Mudanca em pagamento/auth/master sem threat model

**Ordem em features sensiveis:**
```
Architect → Security (threat model) → DBA → Backend → Security (RLS + auth review) → Frontend → QA → Security (final gate) → Infra
```

**Triggers automaticos (invocacao pelo Conductor):** task tocando auth, permissoes, RLS, policies, secrets, CORS, webhook, pagamento, OAuth, PII, LGPD, master_users, service_role, `supabase/config.toml`, `.github/workflows/`, Dockerfile.

## Alternativas consideradas

1. **Manter seguranca distribuida entre Infra/Backend/DBA.** Rejeitado — nao havia dono, concerns ficavam abertos sem acao.
2. **Contratar auditoria externa anual apenas.** Rejeitado — reativo, sem threat model vivo, sem gate no pipeline.
3. **Fundir Security + Infra.** Rejeitado — Infra ja tem escopo largo (deploy, CI/CD, monitoring), diluiria ainda mais o foco em seguranca.

## Consequencias

**Positivas:**
- Dono claro de todo finding de seguranca
- Gate formal em deploys de superficie sensivel
- Threat model vivo e versionado em `.specs/codebase/SECURITY.md`
- LGPD trata formal em vez de implicit
- Reducao de risco de incidente

**Negativas / custos:**
- Overhead em features sensiveis (extra passo de threat model + review)
- Pode bloquear deploys — exige disciplina do time em responder rapido a findings
- Exige ferramental novo no CI (Semgrep, Gitleaks, Trivy, pgTAP no pipeline)

**Neutras:**
- CLAUDE.md e Conductor atualizados pra refletir o novo time de 10
- `.specs/codebase/SECURITY.md` criado como fonte de verdade do threat model
- Notas Obsidian em `06 — Features/Seguranca/`

## Proximos passos

1. Habilitar Gitleaks + Semgrep em pre-commit e CI
2. Migrar `rls-org-isolation.test.ts` pra rodar em CI (com Supabase local)
3. Auditoria das 49 edge functions `verify_jwt = false` — classificar em 3 grupos
4. Schedule de rotacao de secrets (90d) — Asaas, Gemini, Evolution, Meta, TinyERP, SZ.Chat, ElevenLabs
5. Mapear PII e bases legais LGPD em `.specs/codebase/SECURITY.md`
6. Implementar audit log de master/admin
7. HMAC signature em webhooks Asaas, Meta, Cal.com
8. Rate limiting persistente (substituir `Map()` in-memory)

## Referencias

- [.claude/skills/agent-security/SKILL.md](../../../../.claude/skills/agent-security/SKILL.md)
- [.specs/codebase/SECURITY.md](../../../../.specs/codebase/SECURITY.md)
- [.specs/codebase/CONCERNS.md](../../../../.specs/codebase/CONCERNS.md)
- [[ADR-2026-04-12-arquitetura-inicial]]
