---
type: identity
title: Remodelagem — MOC
status: active
created: 2026-05-26
updated: 2026-05-26
tags: [remodelagem, modularizacao, arquitetura, claude-code, torque-crm]
related:
  - "[[ADR-2026-05-26-modularizacao-monolito-modular]]"
  - "[[auditoria-duplicatas]]"
  - "[[event-bus-plano]]"
owner: gabriel
---

# 10 — Remodelagem

Projeto **Modularização do Torque CRM**. Codebase saiu do estágio "MVP single-dev" e está entrando em "empresa média". Reorganização por **bounded context** (DDD) com fronteiras enforced via tooling + comunicação inter-módulo via **eventos de domínio**.

Fundamentação: clipping [Augusto Galego — "Acabou o hype de microsserviços. Voltamos pra 2010"](../../Clippings/(1197)%20Acabou%20o%20hype%20de%20microsserviços.%20Voltamos%20pra%202010.md). Não é microsserviços. É monolito modular.

## Estrutura desta área

### 01 — As-Is (problemas atuais)
- [[panorama-atual]] — Números crus do codebase hoje (223 hooks, 97 edge functions, 62 pastas components, 63 módulos `_shared/`)
- [[problemas-criticos]] — Top dores: blast radius, AI agents perdidos, duplicatas, acoplamento síncrono
- [[duplicatas-mapeadas]] — Lista concreta de funções/hooks/components/edges duplicados ou sobrepostos

### 02 — Solução (decisões arquiteturais)
- [[monolito-modular]] — Por que monolito modular (não microsserviços, não status quo)
- [[event-bus]] — Como módulos conversam: `domain_events` + dispatcher cron
- [[boundary-enforcement]] — ESLint `boundaries` + `dependency-cruiser` + CI gate
- [[bounded-contexts]] — 14 BCs derivados do CONTEXT.md (identity, leads, pipelines, communication, copilot, workflows, campaigns, carteira, engagement, analytics, billing, marketing, integrations, platform)

### 03 — To-Be (goal do projeto)
- [[estrutura-final]] — Layout `src/modules/<bc>/` e `supabase/functions/<bc>/<fn>/`
- [[principios-modulo]] — Regras: API pública via `index.ts`, cross-import proibido, sub-CLAUDE.md obrigatório
- [[criterios-sucesso]] — Checklist objetivo de conclusão

### 04 — Execução
- [[slices]] — 19 slices vertical thin, mergeáveis em develop
- [[decisoes-pendentes]] — Bloqueios aguardando CTO
- [[riscos-mitigacoes]] — Codemod, hotfix protocol, deploy edge fn

## Documentos vinculados (existentes)

- ADR: [[ADR-2026-05-26-modularizacao-monolito-modular]] (04 — Decisões)
- SPEC: [`.specs/features/modularizacao/SPEC.md`](../../../.specs/features/modularizacao/SPEC.md)
- Auditoria detalhada: [[auditoria-duplicatas]] (06 — Features/modularizacao)
- Event-bus detalhado: [[event-bus-plano]] (06 — Features/modularizacao)

## Estado

| Fase | Status |
|------|--------|
| Diagnóstico (As-Is) | ✅ Concluído |
| ADR + SPEC | ✅ Concluído (aguarda aprovação CTO) |
| Auditoria duplicatas | ✅ Concluído |
| Event-bus plano | ✅ Concluído |
| Slice 1 (tooling) | ⏳ Bloqueado por aprovação |
| Slices 2-20 | ⏳ Sequencial pós-aprovação |

## Branch atual

`feat/modularizacao/planejamento` — contém ADR + SPEC + auditoria + event-bus plano + esta área.
