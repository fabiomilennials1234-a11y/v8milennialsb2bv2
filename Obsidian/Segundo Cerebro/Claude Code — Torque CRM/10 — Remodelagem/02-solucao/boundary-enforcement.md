---
type: reference
title: Solução — Boundary Enforcement
status: active
created: 2026-05-26
tags: [remodelagem, solucao, tooling, eslint]
related: ["[[monolito-modular]]", "[[principios-modulo]]"]
---

# Solução — Boundary Enforcement

Disciplina enforced por tooling, não por boa vontade.

## Stack

### `eslint-plugin-boundaries`

Cada módulo declarado. Imports cross-module só via `index.ts` público.

```json
{
  "settings": {
    "boundaries/elements": [
      { "type": "module", "pattern": "src/modules/*", "mode": "folder" },
      { "type": "ui", "pattern": "src/ui/*" },
      { "type": "shared", "pattern": "src/shared/*" },
      { "type": "core", "pattern": "src/core/*" }
    ]
  },
  "rules": {
    "boundaries/element-types": ["error", {
      "default": "disallow",
      "rules": [
        { "from": "module", "allow": ["ui", "shared", "core", "module"] },
        { "from": "ui", "allow": ["shared"] },
        { "from": "shared", "allow": ["core"] },
        { "from": "core", "allow": [] }
      ]
    }],
    "boundaries/no-private": ["error", { "allowUncles": false }]
  }
}
```

Regra `no-private` força que módulo A só importe de `@/modules/B` (API pública via `index.ts`) — não de `@/modules/B/hooks/internal/...`.

### `dependency-cruiser`

Gera grafo de deps. CI falha se ciclo entre módulos.

```javascript
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true }
    },
    {
      name: "module-internals-private",
      severity: "error",
      from: { path: "^src/modules/([^/]+)" },
      to: { path: "^src/modules/(?!\\1)([^/]+)/(?!index)" }
    }
  ]
};
```

### CI gate

GitHub Actions adiciona step:
```yaml
- run: npx dependency-cruiser --validate src
- run: npx eslint src --max-warnings 0
```

PR não merge se violação.

## Rollout (warn → error)

Slice 1 do SPEC: ESLint instalado em **warn-only**. Permite debug de regras + ajuste sem bloquear.

Slice 17 do SPEC (docs): flip pra **error**. CI gate ativo.

Por que warn primeiro: setup novo + 18 slices de migração paralelos. Erro de boundary durante migração paralisaria slices. Warn permite progredir + auditar antes de hard gate.

## Convenções

- Imports inter-módulo SEMPRE via `@/modules/<bc>` (não `@/modules/<bc>/internal/...`)
- Imports intra-módulo livres (`./hooks/useFoo`)
- `shared/`, `ui/`, `core/` importáveis de qualquer lugar
- `core/` não importa de ninguém
- Backend (`supabase/functions/`): mesma regra via dependency-cruiser custom config (sem ESLint nativo do Deno)

## O que NÃO é enforced

- Quantidade de exports por `index.ts` (qualidade de API pública = code review)
- Profundidade de import (`@/modules/leads/index` ou `@/modules/leads` — ambos OK)
- Naming de arquivos dentro do módulo (convenção, não regra)

## Refs

- [[monolito-modular]]
- [[principios-modulo]]
- SPEC slice 1 (tooling) + slice 17 (flip warn→error)
