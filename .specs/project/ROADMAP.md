# Roadmap — Torque CRM

**Last updated:** 2026-04-26

## Active

### Automations Hardening (3 ondas)

| Onda | Status | Specs | ETA |
|---|---|---|---|
| Onda 1 — Fix bleeding | Aprovado, awaiting kickoff | `automations-onda-1/` | 4 dias úteis |
| Onda 2 — Visibility | Specced, depends Onda 1 | `automations-onda-2/` | 3-4 dias úteis |
| Trilha 3.A — Unificação engines | Specced, depends Onda 2 | `automations-trilha-3/` | ~7 sem |
| Trilha 3.B — Refactor copilot | Specced, depends Onda 2 | `automations-trilha-3/` | ~8 sem |

### Coverage 70% (active sprint)

Status: in progress (Sprint 0 done baseline 9.33% → 706 tests).

## Backlog

- `org-quota-enforcement` — implemented, integration + E2E pending
- `agent-team-system` — operational
- `analytics-marketing-redesign` — specced
- `cache-optimization` — specced
- `master-api-status` — specced
- `metrics-period-filter` — specced

## Done

- `org-quota-enforcement` — D004 + D005 (2026-04-09)
- `agent-team-system` — D006 (2026-04-13)
- `chat-onda-2a/2b/3/3-2` — multiple (2026-04 fases)
- `copilot-media-knowledge-base` — done
- `copilot-structured-prompt` — done
- `t2-t5-auth-rls-tests` — D003 trilha (in progress)
- `workflow-new-nodes` — done
- `api-documentation` — done

## Roadmap notes

- Ondas 1+2 são prereq técnico de Trilha 3 (precisa visibility pra validar refactor)
- Trilha 3.A + 3.B podem rodar paralelas se houver 2 devs/agents
- CTO define janela explícita pra Trilha 3 (8 semanas competem com features de produto)
