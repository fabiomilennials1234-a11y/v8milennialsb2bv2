# Roadmap — Torque CRM

**Last updated:** 2026-04-26

## Active

### Automations Hardening — DEPLOYED PROD 2026-04-26

| Onda/Fase | Status | Notas |
|---|---|---|
| Onda 1 P0+P1+P2+P3 | ✅ **prod** | 47k+ erros eliminados, drift transfer 125→0 |
| Onda 2 backend (system_alerts + audit + perf) | ✅ **prod** | Telemetria fluindo |
| Onda 2 frontend (/master/automation-health) | ✅ **prod** | 7 tabs operacionais |
| Trilha 3.B B1 (17 funções extraídas) | ✅ **prod** | agent-engine 3314→2828 LOC |
| Trilha 3.B B2 (88 testes 100%) | ✅ **commited** | Coverage pure functions |
| Trilha 3.B B3 (feature flag v1/v2) | ✅ **prod** | UI master toggle |
| Trilha 3.A A1 (cols + RPCs conversor) | ✅ **prod** | additive only |
| Trilha 3.A A2 (shim dispatchers) | ✅ **prod** | sem dup risk |
| Trilha 3.A A3 (migration converteu 1 rule) | ✅ **prod** | 1 wrapper criado |
| Trilha 3.A A4 (cleanup) | ⏳ **+30d soak** | drop crons + tabelas legadas |
| Trilha 3.B B4 (piloto v2) | ⏳ **quando v2 divergir** | hoje v1==v2 |
| Trilha 3.B B5 (rollout 100%) | ⏳ **+60d após piloto** | — |

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
