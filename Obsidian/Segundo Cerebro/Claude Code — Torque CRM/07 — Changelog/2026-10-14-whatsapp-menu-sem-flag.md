---
type: changelog
title: WhatsApp Menu (pergunta com botões) padrão para todas as orgs
status: in-progress
created: 2026-10-14
updated: 2026-10-14
tags: [changelog, automacoes, whatsapp, pergunta-com-botoes]
related: ["[[pergunta-com-botoes]]"]
owner: claude-agent
---

# 2026-10-14 — WhatsApp Menu sem feature flag

## Mudanças
- **Automações / editor (V5 + clássica)**: flag por org removida; "WhatsApp Menu" sempre disponível em Comunicação (inclusive org com nó unificado). `visibleNodeGroups` perdeu o 2º parâmetro; toolbar/paleta perderam `questionButtonsEnabled`.
- **Nó legado `send_whatsapp_menu`**: cartão em leitura + conversão explícita via `convertLegacyMenuNode` (snapshot antes, toast com "Desfazer", pede religar as saídas). O seletor de tipo usa a mesma função.
- **Painel da pergunta**: aviso quando a org não tem instância Uazapi.
- **Edge**: executor e API de imagem não consultam mais `feature_flags`.
- **SQL (não aplicado)**: `20271122000000_workflow_buttons_sem_flag.sql` — CREATE OR REPLACE de freeze (INVOKER) e guard (DEFINER) sem o bloco do gate, a partir do corpo de prod; DO de guarda aborta se o md5 atual divergir. Rollback em `rollback/`.

## Arquivos tocados
- `src/modules/workflows/lib/convertLegacyMenuNode.ts` (+ teste), `components/sidebar-panels/LegacyMenuCard.tsx` — novos.
- `src/modules/workflows/{components/WorkflowSidebar.tsx,components/sidebar-panels/{ActionPanel,ActionTypeSelector,QuestionButtonsPanel}.tsx,components/{WorkflowToolbar,WorkflowPalette}.tsx,lib/node-groups.ts,pages/AutomacoesEditor.tsx}`, `src/types/workflow.ts`.
- `classic/src/...` espelho + `scripts/ui-classic/classic.patch` regenerado; `tests/classic/workflow-*.test.ts(x)`.
- `supabase/functions/_shared/{workflow-executor,workflow-question-image}.ts`.
- `tests/integration/workflow-buttons-sem-flag.test.mjs` (PGlite) + `tests/integration/fixtures/workflow-buttons-baseline.sql`; seeds de `tests/integration/workflow-buttons/` sem a chave.

## Decisões
- Conversão explícita, sem migração de dados nem upgrade silencioso: a aresta sem handle do menu antigo não mapeia para as 4 saídas obrigatórias.
- Sem fallback para texto em provider não-Uazapi.
- Chave em `feature_flags` não limpa em prod (inerte; escrita via `set_org_settings`).

## Follow-ups
- Aplicar a migration, deployar `process-workflow-executions`, `test-workflow-system`, `workflow-question-image`, depois o front dual.
- Nó unificado `messageType: "menu"` (Improving) segue no `MenuNodeConfig` antigo — decisão do CTO.
