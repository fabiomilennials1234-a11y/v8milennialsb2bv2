---
type: feature
title: Automações — Copiar/Colar Nós
status: active
created: 2026-06-03
updated: 2026-06-03
tags: [workflows, editor, ux]
related: []
owner: gabriel
---

# Automações — Copiar/Colar Nós

## TL;DR

Editor de automações ganhou copy/paste/duplicate de nós no canvas. Permite clonar um nó (ou um sub-fluxo inteiro com várias edges) carregando toda a config interna, operando como nó independente. Caso de uso motriz: split pra 2 vendedores — construir a branch do vendedor 1 e duplicar pro 2 sem refazer config.

## O que é

100% frontend. O `definition` jsonb já persiste nodes/edges arbitrários e o executor roda qualquer grafo válido — copy/paste só gera mais nós de tipos já suportados. Zero schema/RLS/edge-function.

Clipboard vive em memória (`useRef`) dentro do `AutomacoesEditor`, escopo do mesmo editor. NÃO usa System Clipboard API (objeto JS aninhado, sem serialização/permissão). Cross-workflow paste continua via Export/Import.

## Como funciona

- **Copiar** (`Ctrl/Cmd+C`): captura nós selecionados + edges cujos **dois** endpoints estão na seleção (edges-fronteira são descartadas).
- **Colar** (`Ctrl/Cmd+V`): clona, gera IDs novos pelo counter do editor, remapeia edges, offset +60/+60, deseleciona originais e seleciona os colados.
- **Duplicar** (`Ctrl/Cmd+D`): copy+paste atômico do que está selecionado, sem mexer no clipboard. Fallback: nó aberto na sidebar.
- **Botão "Duplicar Nó"**: na sidebar quando um nó (não-trigger) está selecionado.

Lógica pura e testável em `src/modules/workflows/lib/clipboard.ts`:
- `extractSelection(nodes, edges)` — seleção copiável + edges internas.
- `cloneSelection(selection, genNodeId, offset?)` — clone com remap.

Wiring em `src/modules/workflows/pages/AutomacoesEditor.tsx` (handlers + listener `keydown` no `window`). Botão em `src/modules/workflows/components/WorkflowSidebar.tsx`.

## Regras de negócio

- **Trigger nunca é copiável nem colável** — workflow tem exatamente 1 trigger. Filtrado no `extractSelection` e no `cloneSelection`.
- **GotoNode.targetNodeId**: se o alvo está **dentro** da seleção → remapeia pro ID novo; se **fora** → mantém o original (jump ainda aponta pra nó real).
- **SplitAb**: edges com `sourceHandle = variant_<id>` → remapeia o `source` (nodeId) mas **preserva** o `sourceHandle` (a variant vive no `node.data`, clonado intacto).
- **IDs**: minted pelo mesmo `nodeIdCounter` (module-level) usado pelo "Adicionar Nó", garantindo unicidade global no grafo (counter é setado pro `maxId+1` no load).

## Edge cases

- Atalhos **não disparam** com foco em `input`/`textarea`/`contenteditable`.
- `Ctrl+D` sempre `preventDefault` (sobrescreve bookmark do browser). `Ctrl+C/V` só `preventDefault` quando há ação real (não sequestra copy/paste nativo de texto).
- Colar com clipboard vazio = no-op silencioso. Duplicar sem seleção = no-op.
- Não interfere no delete nativo (`Backspace`/`Delete` já mapeado no ReactFlow `deleteKeyCode`).

## Áreas frágeis

🟠 Workflows é área frágil (executor/DAG). Esta feature **não toca** `_shared/workflow-*` — só produz nós de tipos existentes, grafo permanece válido. Multi-tenancy N/A (sem query nova).

## Testes

`src/modules/workflows/lib/clipboard.test.ts` — 11 casos: trigger filtrado, edges-fronteira excluídas, remap goto interno/externo, splitAb handle preservado, independência do clone, IDs de edge únicos.

## Histórico

- 2026-06-03 — Feature criada (copy/paste/duplicate + atalhos + botão sidebar + lib pura).
