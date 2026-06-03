---
type: changelog
title: 2026-06-03 — Automações copy/paste de nós
created: 2026-06-03
updated: 2026-06-03
tags: [workflows, editor]
related: ["[[copy-paste-nodes]]"]
owner: gabriel
---

# 2026-06-03

## Mudanças

- **workflows/editor**: copy/paste/duplicate de nós no canvas de automações. Clona nó único ou sub-fluxo inteiro (nós + edges internas) carregando config. Atalhos `Ctrl/Cmd+C/V/D` + botão "Duplicar Nó" na sidebar. 100% frontend, zero schema.

## Arquivos tocados

- `src/modules/workflows/lib/clipboard.ts` — NOVO. Lib pura: `extractSelection` + `cloneSelection` (remap IDs/edges/goto, preserva splitAb handle, filtra trigger).
- `src/modules/workflows/lib/clipboard.test.ts` — NOVO. 11 casos Vitest.
- `src/modules/workflows/pages/AutomacoesEditor.tsx` — clipboardRef, `genNodeId`, handlers copy/paste/duplicate, listener keydown.
- `src/modules/workflows/components/WorkflowSidebar.tsx` — prop `onDuplicateNode` + botão "Duplicar Nó" (oculto pro trigger).

## Decisões

- Clipboard em `useRef` (memória), não System Clipboard API — escopo intra-editor, sem serialização. Cross-workflow segue via Export/Import.
- Goto interno remapeia, externo preserva. SplitAb `sourceHandle` preservado (variant vive no node.data).
- Trigger nunca clonável (1 por workflow).

## Follow-ups

- Possível: paste posicionado no cursor do mouse (hoje offset fixo +60/+60).
- Possível: indicador visual de "N nós no clipboard".
