# CLAUDE.md — `src/lib/`

Helpers e utilities do frontend. **Sem componentes UI, sem hooks aqui** —
puro logic.

## Módulos principais

- `permissions.ts` — engine de permissões (3 camadas) frontend. **Área 🟠 frágil.**
- `supabase.ts` — cliente Supabase configurado
- `whatsappApi.ts` — wrapper da API WhatsApp (via proxy)
- `utils.ts` — `cn()` (Tailwind class merger) + outros utilities
- (outros — conferir filesystem)

## Permissions — 🟠 atenção

> Ver [`Obsidian/.../06 — Features/Admin/Permissoes Sistema.md`](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/06%20—%20Features/Admin/Permissoes%20Sistema.md)
> e [`02 — Arquitetura/Multi-tenancy`](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/02%20—%20Arquitetura/Multi-tenancy.md).

**Estado atual:** barreira final client-side em alguns paths. Server-side
gate pendente (ver
[`08 — Backlog/backlog/move-pipe-record-server-side`](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/08%20—%20Backlog/backlog/move-pipe-record-server-side.md)).

### Camadas

1. **Master role** — cross-org, super-poder
2. **Org admin** — admin da org, pode tudo dentro
3. **Feature permissions** — toggles por feature (`copilot_enabled`, etc.)
4. **Role matrix** — `admin` / `master` / `membro` × ação

### Hooks
- `useUserRole()` — retorna role do user atual
- `useCanPerformAction(action)` — checa ação específica
- `useMasterAuth()` — gate master role

### Fallback fail-closed

Estado loading deve **bloquear** ação, não permitir. Cuidado com
fallback `allowed: true` legado — ver
[`permissions-fallback-fail-closed`](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/08%20—%20Backlog/backlog/permissions-fallback-fail-closed.md)
(MEDIUM, a auditar).

### Testes
`tests/integration/permission-engine.test.ts` — testar admin/membro/master
separadamente. Edge: role muda mid-sessão.

## Convenções

### Imports
Sempre `@/` alias:
```typescript
import { something } from "@/lib/something";
```

### Funções puras
Tudo aqui deve ser puro (sem side effects exceto IO declarado). Hooks vão pra
`src/hooks/`. Componentes pra `src/components/`.

### Tipos
Usar `Tables<"tabela">` de `@/integrations/supabase/types` quando referenciando
linhas. **Nunca editar** `types.ts` manualmente.

### Naming
- Funções: `camelCase`
- Constantes: `SCREAMING_SNAKE_CASE`
- Tipos: `PascalCase`
- Arquivos: `kebab-case.ts` ou `camelCase.ts` (consistente com o módulo)

## Não fazer

- ❌ Componente React aqui — vai pra `src/components/`
- ❌ Hook React aqui — vai pra `src/hooks/`
- ❌ Side effect na importação (top-level)
- ❌ Ler `.env` direto — usar `import.meta.env` no Vite
- ❌ Chamar `useState`/`useEffect` — não é React aqui

## Sub-módulos

(stub — preencher conforme tasks tocam)

## Áreas frágeis

- `permissions.ts` — 3 camadas, fallback fail-open legado (a fix)
- `whatsappApi.ts` — depende de `whatsapp-api-proxy` edge fn
