---
type: reference
title: As-Is — Problemas Críticos
status: active
created: 2026-05-26
tags: [remodelagem, as-is, problemas]
related: ["[[panorama-atual]]", "[[duplicatas-mapeadas]]"]
---

# As-Is — Problemas Críticos

Por que remodelar. Sintomas medidos, não opinião.

## 1. Codebase organizado por camada técnica, não por domínio

Hooks/components/pages/functions agrupados por **o que são tecnicamente** (hook React, componente, função Deno), não pelo **domínio que servem** (lead, pipeline, comunicação, etc.).

Consequência: pra entender o domínio "lead", o dev (ou AI agent) navega 5 pastas diferentes (`hooks/`, `components/lead/`, `components/lead-detail/`, `components/leads/`, `pages/Leads.tsx`) e cruza referências mentais. Mental model existe — só não está fisicamente representado.

CONTEXT.md já documenta **14 bounded contexts** explícitos. A arquitetura lógica existe. A física não reflete.

## 2. Onboarding lento

CTO + dev junior + 3 AI agents. Sem âncoras físicas de domínio:
- Dev junior demora pra mapear "onde mora X"
- AI agents fazem search trips repetidos (`Grep` por padrão, lendo dezenas de arquivos)
- Conhecimento crítico vive na cabeça do CTO

Não escalaria pra 5+ devs. Não escala pra 6+ AI agents trabalhando em paralelo.

## 3. Blast radius alto

Qualquer mudança "no lead" toca arquivos em 5+ pastas. PR de feature média acumula:
- 8-15 arquivos em pastas distintas
- Conflitos com features paralelas
- Code review difícil (reviewer precisa reconstruir contexto)
- Risco de quebrar consumers desconhecidos

## 4. Duplicatas concretas (não suposição — medidas)

Detalhe completo em [[duplicatas-mapeadas]].

Resumo:
- **Hooks**: 4 sobre histórico/timeline do lead, 3 sobre copilot toggle, 3 sobre realtime, 16 misturando pipe legacy vs pipeline novo
- **Components**: 3 pastas pra lead, 6 pra pipeline, 4 pra carteira, 6 pra dashboard/analytics, 8 pra engagement
- **Edge functions**: 8 `tinyerp-*`, 7 `whatsapp-*`, 8 `process-*`, 12 copilot, 9 identity admin; webhooks ambíguos (`lead-webhook` vs `webhook-new-lead`, `webhook-calcom` vs `meeting-webhook`)
- **`_shared/`**: 12 módulos de message stack espalhados, `actions/` vs `action-handlers/` ambíguos, `auth.ts` vs `user-auth.ts`

## 5. Acoplamento síncrono cross-domain

Módulos se comunicam via **chamada direta de função**. Quando lead muda de stage:
1. Pipeline chama `triggerStageChangedWorkflows()` em **3 lugares** distintos
2. Às vezes 2x pro mesmo evento (bug `triggerStageChangedWorkflows-duplicate` em backlog)
3. Às vezes esquecido (workflow não dispara em código novo)

Pipeline acopla Workflow acopla Campaign acopla Notification. Adicionar listener novo = caçar todos os emissores e modificar.

## 6. Pastas/arquivos órfãos

- `src/pages/MockupChatV3 2.tsx` (espaço no nome = filename corrompido de copy-paste)
- 4 variantes `MockupChat*` sem clareza de qual é canônica
- `src/hooks/useFieldChangelog.ts` exporta só `FIELD_LABELS` (sem queryFn — sobreposto com `useFieldChanges`)
- Edge functions test/dev no prod root (`test-copilot-chat`, `test-workflow-system`, `webhook-send-test`)

## 7. Naming inconsistente

- Pages: `PipePropostas.tsx` vs `Negocios.tsx` (mesmo domínio, idiomas mistos)
- Frontend: `campanhas/` (PT) + `pages/campaigns/` (EN) coexistem
- `auth.ts` vs `user-auth.ts` em `_shared/` (sem fronteira clara)

## 8. Sub-CLAUDE.md cobre só 5 áreas

Resto do codebase sem ownership documentado. AI agents operam sem âncora por domínio. Repetem perguntas que sub-CLAUDE.md responderia ("onde está X?", "o que essa pasta faz?").

## 9. Ausência de boundary enforcement

Hoje cross-import é livre. Nenhum ESLint rule impede `pipelines/` importar de internals de `leads/`. Tooling não força a disciplina — ela depende de boa vontade humana.

## 10. Sintoma de escala

Codebase nasceu MVP single-dev (CTO sozinho 2 anos). Funcionou. Agora:
- +1 dev humano
- +3 AI subagentes
- Plano de crescer time

Padrão antigo (organização técnica) era OK pra single-dev. Quebra com paralelismo. **Janela exata pra monolito modular** segundo clipping de fundamentação: empresa média de 10-50 pessoas (ou equivalente em produtividade via AI agents).

## Bugs reais correlatos no backlog

- `triggerStageChangedWorkflows-duplicate.md` — sintoma direto de acoplamento síncrono cross-module
- `permissions-fallback-fail-closed.md` — permissões em 3 camadas espalhadas
- `tests-unit-usePipeConfirmacao-useLeads-sync.md` — hooks de pipe legacy não testados isoladamente
- `consolidate-permissions-storage.md` — permission engine espalhada
- `server-side-enforcement-phase2.md` — gate server-side ausente

Todos resolvidos ou facilitados por modularização + event-bus.

## Refs

- [[panorama-atual]] — números
- [[duplicatas-mapeadas]] — lista concreta
- ADR: [[ADR-2026-05-26-modularizacao-monolito-modular]]
- Backlog: `08 — Backlog/backlog/`
