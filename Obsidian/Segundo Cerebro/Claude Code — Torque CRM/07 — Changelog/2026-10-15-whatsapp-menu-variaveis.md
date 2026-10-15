---
type: changelog
title: WhatsApp Menu — variáveis {{x}} no texto da pergunta
status: in-progress
created: 2026-10-15
updated: 2026-10-15
tags: [changelog, workflows, whatsapp, pergunta-com-botoes]
related: []
owner: claude-agent
---

# 2026-10-15 — WhatsApp Menu: variáveis `{{x}}` no texto da pergunta

## Mudanças
- **Runtime**: texto da pergunta com botões resolve `{{x}}` na hora do envio, sobre o snapshot congelado (`content`), com o mesmo `resolveVariables` do menu legado. Rótulos dos botões seguem literais (resposta casa por id).
- Texto resolvido é regravado em `workflow_button_questions.content.text` (filtro `id + org + state='sending'`) antes do HTTP — espelho do chat mostra o que o lead recebeu.
- Texto que resolve para vazio não é enviado: `send_preflight_failed` → saída Falha no envio.
- Fila (`sendQueuedWorkflowQuestions`) só lê `workflow_executions.context` quando o texto contém `{{`, filtrando `id + organization_id`.
- **Editor (V5 + clássica)**: `QuestionButtonsPanel` ganha `VariableInserter`; `TemplateTextarea` aceita `id` opcional. Insere `{{x}}`.

## Arquivos tocados
- `supabase/functions/_shared/workflow-buttons/runtime.ts`
- `src/modules/workflows/components/{TemplateTextarea.tsx,sidebar-panels/QuestionButtonsPanel.tsx}` + espelho em `classic/` + `scripts/ui-classic/classic.patch`
- Testes: `tests/unit/workflow-question-variables.test.ts`, `tests/classic/QuestionButtonsPanel.variables.test.tsx`, `src/modules/workflows/components/__tests__/QuestionButtonsPanel.test.tsx`

## Decisões
- `{x}` (chave simples) segue literal — suporte fica para PR separado.
- Sem migration: `fail_workflow_button_question` já aceita `send_preflight_failed`.

## Deploy
- Edge `process-workflow-executions` + `test-workflow-system` (worktree limpo de origin/main pós-merge) + front build dual.

## Follow-ups (não-bloqueantes)
- N1 erro ao ler `workflow_executions` é ignorado → variável do context sai literal.
- N2 SELECT do lead em `resolveVariables` sem filtro de org (afeta legado).
- N3 UPDATE de 0 linhas se a ocorrência sair de `sending` (herdado).
- N4 re-resolução herdada.
- Portar teste "fila sem `{{` não lê `workflow_executions`".
