---
type: changelog
title: Carteira em rota própria /carteira
status: in-progress
created: 2026-10-16
updated: 2026-10-16
tags: [changelog, leads, carteira, navegacao]
related: []
owner: claude-agent
---

# 2026-10-16 — Carteira em rota própria `/carteira`

## Mudanças
- **Carteira**: página nova `/carteira` com o `ClientPortfolioSection` da antiga aba Clientes de `/leads` (filtros, segmentos, paginação, painel 360, Novo negócio).
- **Leads**: aba Clientes removida; `cliente` persistido/visão salva redireciona uma vez para `/carteira`.
- **Navegação**: item Carteira após Leads (lateral V5), gaveta "Mais" no mobile, paleta, recentes, atalho `g r`.

## Arquivos tocados
- `src/modules/leads/pages/Carteira.tsx`, `src/modules/leads/pages/Leads.tsx`
- `src/modules/leads/hooks/useRedirecionaAbaClientes.ts`, `src/modules/leads/lib/{carteira-route,lead-list-origins,lead-classificacao}.ts`
- `src/App.tsx`, `src/modules/platform/lib/{navigation-model,feature-registry}.ts`, `src/modules/platform/components/command/groups/{CommandGroupNavigation,CommandGroupRecents}.tsx`, `src/modules/platform/hooks/useGlobalShortcuts.ts`, `src/modules/platform/components/layout/MainLayout.tsx`

## Decisões
- Gate da rota = gate de `/leads` (`leads.view` + feature `leads`), não `carteira` (essa tranca o `/upsell` legado).
- Mobile: sem slot novo (5 ocupados); Carteira entra pela gaveta "Mais", que lê `SIDEBAR_PRIMARY`.
- Atalho `g r`: `g c` segue sendo Chat em `useKeyboardShortcuts`.

## Follow-ups
- Sem schema, sem migration, sem RLS. Nada deployado.
