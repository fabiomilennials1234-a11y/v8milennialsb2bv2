---
type: changelog
title: Slice 1 — Tooling (ESLint boundaries + dependency-cruiser + CI gate)
status: shipped
created: 2026-05-26
tags: [changelog, modularizacao, tooling, eslint, dependency-cruiser]
related:
  - "[[ADR-2026-05-26-modularizacao-monolito-modular]]"
  - "[[slices]]"
owner: gabriel
---

# Slice 1 — Tooling (warn-only inicial)

Primeira slice da Modularização. Adiciona tooling de boundary enforcement sem mover código.

## O que mudou

### Frontend ESLint (`eslint.config.js`)

- Adicionado `eslint-plugin-boundaries` (devDependency)
- 4 elements declarados:
  - `module` → `src/modules/*` (folder mode, populado a partir slice 2)
  - `ui` → `src/components/ui/**` (shadcn primitivos existentes)
  - `shared` → `src/shared/**`
  - `core` → `src/core/**`
- Regras `boundaries/element-types` + `boundaries/no-private` em **warn**
- `default: "allow"` (não bloqueia código não classificado durante transição)
- Flip para `error` programado pra slice 17

### Dependency-cruiser (`.dependency-cruiser.cjs`)

- 3 regras: `no-circular` (warn), `module-internals-private` (warn), `no-orphans` (warn)
- Exclude: node_modules, dist, supabase, scripts, tests, types.ts
- TypeScript-aware (resolve `tsconfig.json`)

### Scripts (`package.json`)

```json
"lint:deps": "depcruise src --config .dependency-cruiser.cjs",
"lint:deps:graph": "depcruise src --config .dependency-cruiser.cjs --output-type dot | dot -T svg -o dependency-graph.svg"
```

### CI (`.github/workflows/test.yml`)

Step `Lint dependency graph` inserido na job `quality`, entre `npm run lint` e `npm run build`. Falha CI se houver violação `error` (atualmente nenhuma — todas warn).

## Detecções pré-existentes

- **0 errors** ESLint (boundaries plugin não introduziu erros)
- **2449 warnings** ESLint (todos pré-existentes a esta slice + boundaries warn-only)
- **13 ciclos** detectados pelo dependency-cruiser, todos no domínio chat (`src/components/chat/` ↔ `src/lib/prefetch/chatPrefetch.ts` ↔ `src/pages/ChatWhatsApp.tsx`)
- **23 warnings** adicionais de orphan/internals

Ciclos documentados em backlog: [[fix-circular-deps-chat-module]]. Precisam ser resolvidos antes do slice 17 (flip warn→error).

## Por que warn-only

Slice 1 só prepara tooling. `src/modules/<bc>/` ainda não existe (slice 2). Boundaries em `error` agora bloquearia 99% dos imports atuais. Plano:

- Slice 1: tooling instalado, warn-only (este slice)
- Slices 2-16: migração progressiva de domínio
- Slice 17: flip warn→error + CI gate full

## Aceite

- [x] `npm run lint` passa (0 errors)
- [x] `npm run lint:deps` passa (0 errors)
- [x] CI job `quality` ainda verde
- [x] Sem mudança de comportamento de produto
- [x] Backlog de ciclos criado

## Branch

`feat/modularizacao/00-tooling` → PR para `develop`.

## Próximo slice

[[slices|Slice 2 — Skeleton]]: criar pastas vazias `src/modules/<bc>/` + sub-CLAUDE.md por bounded context.

## Refs

- ADR: [[ADR-2026-05-26-modularizacao-monolito-modular]]
- SPEC: `.specs/features/modularizacao/SPEC.md`
- Plano boundary: [[boundary-enforcement]]
- Backlog ciclos: [[fix-circular-deps-chat-module]]
