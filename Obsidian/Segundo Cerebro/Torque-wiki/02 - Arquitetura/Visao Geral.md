---
tags:
  - claude-code
  - arquitetura
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-14
last_verified: 2026-04-14
status: active
source_of_truth:
  - CLAUDE.md
  - package.json
  - vite.config.ts
  - supabase/config.toml
---

# Visao Geral da Arquitetura

## Resumo

Torque CRM e um SaaS B2B multi-tenant construido com React + Supabase. Frontend SPA com code-splitting agressivo, backend serverless via Edge Functions (Deno), banco Postgres com RLS para isolamento de tenants.

## Tipo de projeto

- **Tipo**: SPA (Single Page Application)
- **Linguagem principal**: TypeScript (frontend) + TypeScript/Deno (edge functions) + SQL (migrations)
- **Framework frontend**: React 18 com Vite 5 (SWC compiler)
- **Framework backend**: Supabase (BaaS) - nao ha server Node/Express

## Estrutura de pastas (profundidade 3)

> Contagens auto-geradas — rode `npm run docs:sync` para atualizar. Verificado em 2026-04-14.

<!-- auto:counts:start -->
```
src/
├── components/        # 39 categorias de componentes
│   └── ui/            # 51 primitivos shadcn/ui
├── hooks/             # 122 hooks React Query
├── pages/             # 43 paginas (lazy loaded)
└── contexts/          # 3 contexts

supabase/
├── functions/         # 78 edge functions (Deno)
│   └── _shared/       # 33 modulos compartilhados
└── migrations/        # 323 migrations SQL
```
<!-- auto:counts:end -->

## Multi-tenancy

- Toda query filtra por `organization_id`
- RLS no Postgres garante isolamento - nenhuma row cruza orgs
- Frontend nunca envia org_id manualmente - vem do contexto auth
- Master admin (Milennials) tem bypass cross-org invisivel para clientes

## Modelo de permissoes (3 camadas)

```
Master Admin (Milennials)
  └── Organization Admin
        └── Feature Permissions
              └── Role Matrix (admin/membro)
```

**Hooks chave:**
- `useUserRole()` - role do usuario (admin/member)
- `useCanPerformAction(action)` - checa permissao via RPC
- `useMasterAuth()` - bypass total (admin Milennials)

**Engine:**
- Frontend: `src/lib/permissions.ts`
- Backend: `supabase/functions/_shared/permission_engine.ts`

## Autenticacao

- Supabase Auth com JWT
- A maioria das edge functions usa `verify_jwt = false` no config.toml
- Autenticacao feita internamente via:
  - Bearer token manual (funcoes autenticadas)
  - `x-webhook-key` (webhooks externos)
  - `x-cron-secret` (cron jobs)
  - API keys customizadas

## Ambientes

| Ambiente | Supabase Project ID | Uso |
|----------|-------------------|-----|
| Producao | `jsjsmuncfkbsbzqzqhfq` | Clientes reais |
| Development | `bcfadphgsibjzivtbjvc` | Testes e staging |

Organization principal: `6030520a-2ca7-477d-be89-55758e2cd808`

## Code splitting (Vite)

Manual chunks configurados:
- `vendor`: react, react-dom, react-router-dom
- `supabase`: @supabase/supabase-js
- `charts`: recharts
- `motion`: framer-motion
- `query`: @tanstack/react-query
- `dnd`: @dnd-kit

Build: esbuild minifier, source maps habilitados para Sentry, console/debugger removidos em producao.

## Design system

- **Tema**: Dark-first, HSL CSS variables
- **Font**: Inter, system-ui, sans-serif
- **Accent**: Gold `hsl(47 100% 50%)`
- **Dark mode**: Class-based
- **Shadows**: Gold glow (47deg) e success glow (142deg)
- **Container**: Centered, 1400px max, 2rem padding
- **Componentes**: shadcn/ui com customizacao via `cn()` helper

## Links relacionados

- [[MOC - Arquitetura]]

- [[Master Admin]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Copilot]]

- [[Modulos]]
- [[Integracoes]]
- [[00 - INDEX]]

## Notas do agente

> Fonte: `CLAUDE.md`, `package.json`, `vite.config.ts`, `tailwind.config.ts`, `supabase/config.toml`.
> O arquivo de tipos auto-gerado (`src/integrations/supabase/types.ts`) tem 270KB - nunca editar manualmente.
