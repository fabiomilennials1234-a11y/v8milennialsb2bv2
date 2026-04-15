---
tags:
  - claude-code
  - relatorio
  - torque-crm
  - qualidade
created: 2026-04-14
last_updated: 2026-04-14
status: active
periodo: abril-2026
---

# Relatorio de Qualidade — Abril 2026

**Escopo:** Agentes, Sistema, Documentacao, Roadmap, Pontos Criticos.
**Metodologia:** Analise paralela por tres lentes (Architect, Backend/Engineer, QA) + auditoria das definicoes dos agentes e do vault.

Ver tambem: [[00 — INDEX]] · [[Protocolo]] · [[ADR-2026-04-12-arquitetura-inicial]]

---

## 1. Qualidade Atual dos Agentes

**Media geral: 8.4/10**

| Agente | Nota | Status | Destaque | Fragilidade |
|---|---|---|---|---|
| [[Agentes/Conductor\|Conductor]] | 9.0 | Pronto | Triagem + SDD integrados | Sem SLA de triagem, sem matriz de complexidade |
| [[Agentes/Architect\|Architect]] | 8.5 | Pronto | 3 horizontes (agora/10x/100x) | Falta lista de anti-patterns |
| [[Agentes/Backend\|Backend]] | 9.0 | Pronto | Regras concretas de idempotencia/RLS | Hand-off com AI pouco explicito |
| [[Agentes/Frontend\|Frontend]] | 8.5 | Pronto | Dark-first, tokens HSL, lazy loading | Sem checklist WCAG ancorado |
| [[Agentes/DBA\|DBA]] | 9.0 | Pronto | EXPLAIN ANALYZE nao-negociavel | Falta catalogo de queries lentas reais |
| [[Agentes/QA\|QA]] | 8.0 | Pronto | Teste "deployaria sexta a noite" | Sem mapa de gaps, sem exemplos Vitest/Playwright |
| [[Agentes/Infra\|Infra]] | 8.0 | Pronto | Project IDs + trap do JWT documentados | Runbooks referenciados mas ausentes |
| [[Agentes/Automation\|Automation]] | 8.5 | Pronto | 10+ pg_cron jobs mapeados | 20+ workflows n8n nao inventariados |
| [[Agentes/AI\|AI]] | **7.0** | **Fragil** | Reconhece fragilidade, fluxo ponta-a-ponta | Sem timeout SLA, RAG sem exemplos, graceful degradation ausente |

### Lacunas no time

1. **Security** — hoje ad-hoc em Backend/DBA. Sem auditoria sistematica.
2. **Design System** — hoje diluido em Frontend. Sem documento central de tokens e primitivos.
3. **DevRel/Onboarding** — sem guia dedicado para novos devs.

### Protocolo e Roteamento

[[Protocolo]] (9/10) e a matriz de roteamento do Conductor (8.5/10) estao solidos. Falta regra de priorizacao quando multiplos agentes rodam em paralelo e detection de deadlock.

---

## 2. Qualidade Atual do Sistema

**Codigo estrutural:** ~20% legado / ~60% novo-otimizado / ~20% cinza
**Verificabilidade (testes):** ~68% nao coberto — **maior debito tecnico do projeto**

| Dimensao | Nota | Observacao |
|---|---|---|
| Arquitetura | 8.5 | Boundaries claros, multi-tenancy via RLS, _shared maduro |
| Qualidade de codigo | 8.0 | 85% das edge functions no pattern padrao; 542 `any` residuais |
| Performance | 7.5 | Realtime com surgical updates; 28 hooks >300 linhas |
| Seguranca | 7.5 | RLS forte; JWT trap conhecido; falta auditoria sistematica |
| Testes | **4.0** | Ratio 1:23 arquivo-teste:codigo; [[Copilot]] com zero cobertura |
| Observabilidade | 7.5 | Sentry instrumentado; faltam dashboards e alertas |

### Areas exemplares

- [supabase/functions/_shared/](../../../supabase/functions/_shared/) — 35 modulos maduros
- [supabase/functions/agent-message/index.ts](../../../supabase/functions/agent-message/index.ts) — pattern padrao perfeito
- [src/hooks/useRealtimeSubscription.ts](../../../src/hooks/useRealtimeSubscription.ts) — reutilizado em 38 hooks
- [tests/integration/rls-*.test.ts](../../../tests/integration/) — RLS bem coberto
- [src/hooks/useLeads.ts](../../../src/hooks/useLeads.ts) — filters + realtime + cache

### Hotspots criticos de legado

- [supabase/functions/check-api-health/index.ts](../../../supabase/functions/check-api-health/index.ts) — sem withSentry, CORS hardcoded
- [supabase/functions/get-member-permissions/index.ts](../../../supabase/functions/get-member-permissions/index.ts) — sem pattern wrapper
- [supabase/functions/webhook-orchestrator/index.ts](../../../supabase/functions/webhook-orchestrator/index.ts) — `any`, sem Zod
- [src/components/leads/LeadDetailModal.tsx](../../../src/components/leads/LeadDetailModal.tsx) — deprecated, duplica Drawer
- [src/components/copilot/](../../../src/components/copilot/) — core revenue, **zero testes**

Ver tambem: [[Limitacoes]] · [[Modulos]] · [[Visao Geral]]

---

## 3. Qualidade Atual da Documentacao

**Nota global: 8.2/10**

| Secao | Nota |
|---|---|
| [[00 — INDEX]] | 9.0 |
| [[Protocolo]] | 9.0 |
| CLAUDE.md (raiz) | 9.0 |
| [[ADR-2026-04-12-arquitetura-inicial]] | 8.5 |
| [[Visao Geral]] / [[Modulos]] / [[Integracoes]] | 8.5 |
| 06 — Features (46+ notas) | 8.0 |
| [[2026-04-12—sessao-inicial]] | 7.5 |

### Pontos fortes

1. Completude multi-camadas (stack, padroes, gotchas, data model).
2. Areas frageis sinalizadas com `[!danger]` e `[!warning]` em [[Limitacoes]].
3. Protocolo de agentes formalizado e integrado com SDD.

### Lacunas concretas

1. **Changelog ausente** — pasta `07 — Changelog/` nao existe; apenas 1 log em [[2026-04-12—sessao-inicial]].
2. **Zero diagramas C4** — documentacao 100% textual.
3. **Data model sem ER diagram** — 10 tabelas criticas sem visualizacao.
4. **Runbook de incidentes inexistente** — pg_net failure, RLS leak, Realtime degradado sem playbook.
5. **API Reference das edge functions ausente** — [[Webhooks]] menciona "API Docs interativa" mas nao ha schemas.

**Debt documental estimado:** 25–30%. Documentacao e solida mas **refem de disciplina** — sem automacao, envelhece.

---

## 4. Roadmap — Melhores Agentes Trabalham Melhor o Sistema

> **Tese:** investir nos agentes primeiro tem retorno composto. Cada task futura herda a melhoria.

### Fase 0 — Fortalecer os agentes (2 semanas)

1. **Refatorar [[Agentes/AI|agente AI]]** (prioridade maxima): timeout SLA, exemplos de prompt, graceful degradation, E2E obrigatorio antes de claim de conclusao.
2. **Criar agente Security**: CORS audit, JWT traps, RLS verification, secrets scan, OWASP top 10. Reduz ~30% do risco com ~10% das tasks.
3. **Criar agente Design-System** (ou elevar [[Agentes/Frontend|Frontend]]): consolidar tokens, primitivos shadcn customizados, checklist WCAG AA.
4. **Enriquecer agentes existentes:** anti-patterns no Architect; catalogo de queries lentas no DBA; exemplos Vitest/Playwright no QA; runbooks linkados no Infra.
5. **Conductor v2:** matriz de complexidade + regras de priorizacao paralela + SLA de triagem.

### Fase 1 — Parar hemorragia do sistema (2 semanas)

6. **E2E [[Copilot]]** (QA + AI) — feature mais lucrativa, zero cobertura.
7. **Integration test `lead-webhook`** (QA + Backend) — endpoint principal de ingestao.
8. **Padronizar 6 edge functions legadas** (Backend) — `withSentry` + `withSecurityHeaders`.

### Fase 2 — Documentacao duravel (2 semanas)

9. **Changelog automatizado** via git hook → `07 — Changelog/`.
10. **3 diagramas C4 em Mermaid:** contexto, componentes, fluxo IA.
11. **ER diagram das 10 tabelas criticas.**
12. **Runbooks:** pg_net failure, RLS leak, Realtime degradado, Sentry spike.

### Fase 3 — Divida estrutural (4 semanas)

13. **Eliminar `LeadDetailModal`** → migrar consumidores para Drawer.
14. **Decompor 28 hooks >300 linhas** (comecar pelos 5 mais criticos).
15. **Zod em todos os webhooks publicos**; eliminar `any` nas 5 edge functions mais chamadas.
16. **Factories de teste** + **MSW** → destrava testes unitarios de hooks.

### Fase 4 — Guardrails permanentes (continuo)

17. **Cobertura minima via CI** — bloquear PR <40% (subindo 5% ao mes ate 70%).
18. **Dashboard Sentry por edge function** com alerta em taxa de erro >1%.
19. **Auditoria trimestral** pelo agente Security.

### Metas 90 dias

| Metrica | Hoje | Meta |
|---|---|---|
| Agentes com nota >=8.5 | 4/9 | 9/9 |
| Agente AI | 7.0 | >=8.5 |
| Edge functions padronizadas | 85% | 100% |
| Ratio teste:codigo | 1:23 | 1:8 |
| Copilot E2E | 0 | >=3 fluxos |
| `any` em edge functions | 542 | <100 |
| Debt documental | 25–30% | <10% |

---

## 5. Pontos Criticos do Sistema

Ordenados por **risco x probabilidade**:

### Criticos — acao imediata

1. **[[Copilot]] sem testes** — feature mais fragil, mais lucrativa e mais usada. Bug silencioso = churn imediato. Codigo: [src/components/copilot/](../../../src/components/copilot/), [supabase/functions/agent-message/](../../../supabase/functions/agent-message/).
2. **`lead-webhook` sem integration test** — ingestao principal. Quebra = parada de entrada de leads em 20+ clientes. Ver [[n8n Orquestracao]].
3. **pg_net como SPOF** — todos os 10+ cron jobs dependem. Falha silenciosa para webhooks, workflows e dispatches. Sem runbook.
4. **[[Agentes/AI|Agente AI fragil]]** — reconhecidamente instavel, sem timeout, sem graceful degradation. Conversa travada em "pending" e recorrente.

### Altos — proximo mes

5. **[[Permissoes Sistema|Permissoes (3 camadas)]]** — bugs recorrentes conhecidos. Master Admin + Org Admin + Feature Permissions + Role Matrix = superficie de erro grande.
6. **JWT double-negative trap** — `--no-verify-jwt=false` HABILITA JWT. Ja queimou antes. Ver [[Limitacoes]].
7. **6 edge functions fora do padrao** — CORS hardcoded `*`, sem Sentry, sem security headers. Vetor de ataque + cegueira operacional.
8. **RLS como unica defesa em alguns hooks** — sem `eq(organization_id)` explicito. Regressao de policy vira vazamento cross-tenant.

### Medios — proximo trimestre

9. **28 hooks >300 linhas** — manutencao dificil, state bugs nao-reproduziveis.
10. **Duplicacao UI** (`LeadDetailModal` vs `Drawer`) — inconsistencia visual e comportamental.
11. **542 `any` em edge functions** — type safety ilusoria.
12. **Supabase types auto-gerado (270KB)** — fonte de merge conflicts e drifts silenciosos.
13. **20+ workflows [[n8n Orquestracao|n8n]] nao inventariados** — cada cliente tem o seu, sem catalogo central.

### Operacionais

14. **Sem runbook de incidentes** — triagem depende de memoria tribal.
15. **Documentacao refem de disciplina** — sem automacao, envelhece.
16. **Sem agente de Seguranca** — auditoria acontece por acaso.
17. **[[05 — Log de Contexto|Log de Contexto]] com 1 entrada** — disciplina de diario nao esta acontecendo.

---

## Veredicto Executivo

O Torque CRM e um sistema **arquiteturalmente maduro** com **time de agentes bem desenhado** e **documentacao solida**, mas com **tres fraturas visiveis**:

1. **Testes sao divida existencial** — nao e "vamos melhorar", e "vamos parar de operar no escuro".
2. **Copilot + agente AI precisam de cirurgia conjunta** — feature e agente que a governa estao ambos frageis.
3. **Documentacao e agentes envelhecem sem automacao** — o que hoje esta em 8.2 cai para 6 em 6 meses sem CI/CD de docs e revisao trimestral dos agentes.

### Proxima acao recomendada

Abrir SDD (`tlc-spec-driven`) para a **Fase 0, item 1** — refatorar o [[Agentes/AI|agente AI]]. Melhor agente → todas as tasks futuras de [[Copilot]] ficam melhores. **ROI composto.**

---

## Referencias cruzadas

- **Protocolo e agentes:** [[Protocolo]] · [[Agentes/Conductor|Conductor]] · [[Agentes/Architect|Architect]] · [[Agentes/Backend|Backend]] · [[Agentes/Frontend|Frontend]] · [[Agentes/DBA|DBA]] · [[Agentes/QA|QA]] · [[Agentes/Infra|Infra]] · [[Agentes/Automation|Automation]] · [[Agentes/AI|AI]]
- **Arquitetura:** [[Visao Geral]] · [[Modulos]] · [[Integracoes]]
- **Operacional:** [[Scripts e Comandos]] · [[Fluxos de Trabalho]] · [[Limitacoes]]
- **Decisoes:** [[ADR-2026-04-12-arquitetura-inicial]]
- **Features criticas:** [[Copilot]] · [[Permissoes Sistema]] · [[n8n Orquestracao]] · [[Pipe WhatsApp]] · [[Workflow Builder]]
