---
type: architecture
title: Módulos — Mapa do Código
status: draft
created: 2026-05-15
updated: 2026-05-15
tags: [arquitetura, modulos, codigo]
related: ["[[Visao Geral]]", "[[Edge Functions]]"]
owner: gabriel
---

# Módulos — Mapa do Código

> Diátaxis: **Explanation** + **Reference parcial**.
> Lookup de edge functions específicas → [[Edge Functions]].

## Estrutura raiz

```
src/
├── components/    46 categorias, ui/ tem 54 primitivos (shadcn)
├── hooks/         122+ hooks (useQuery wrappers, lógica reutilizável)
├── pages/         46 páginas lazy-loaded
├── contexts/      auth, features, theme
├── lib/           helpers (permissions, supabase client, whatsappApi, etc.)
├── integrations/  Supabase types + client + auth helpers
└── types/         tipos compartilhados não Supabase

supabase/
├── functions/     78+ edge functions Deno
│   └── _shared/   35 módulos compartilhados
└── migrations/    322+ migrations

tests/
├── unit/
├── integration/
└── e2e/
```

## Componentes — categorias chave

(stub — preencher iterativamente)

- `chat/` — chat UI (composer, message list, history sync)
- `copilot/` — agentes UI (lista, playground, metrics)
- `kanban/` — drag-and-drop pipes
- `master/` — super-panel admin (master only)
- `whatsapp/` — gerenciamento de instâncias
- `ui/` — shadcn primitivos
- `forms/` — RHF + Zod components
- `dashboard/` — widgets, charts

## Hooks — convenções

- `use<Tabela>()` — list query da tabela
- `use<Tabela>(id)` — single record
- `useCreate<Entidade>()`, `useUpdate<Entidade>()`, `useDelete<Entidade>()` — mutations
- Pattern: `useQuery({ queryKey: [table, orgId], enabled: !!orgId })`
- Mutations invalidam queryKey no `onSuccess`

## Pages — lazy loaded

(stub — listar via `find src/pages -name '*.tsx'` quando preencher)

## Edge Functions

Ver [[Edge Functions]] para lista completa + padrão.

## `_shared/` — módulos críticos

(stub — preencher)

- `whatsapp-client.ts` + `whatsapp-providers/` — adapter WhatsApp
- `permission_engine.ts` — engine de permissões
- `copilot/` — submódulos do agent engine (após refactor)
- `workflow_engine.ts` — DAG executor
- `ai-action-executor.ts` — ações IA
- `sentry.ts` — wrapper Sentry
- `auth.ts` — extrair org/user do request
