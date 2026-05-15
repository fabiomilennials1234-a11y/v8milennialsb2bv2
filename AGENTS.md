# Torque CRM — Agent Spec

> Agent-agnostic spec. Para Claude Code specifically, ver [`CLAUDE.md`](./CLAUDE.md).
> Para tour profundo, vault em
> [`Obsidian/Segundo Cerebro/Claude Code — Torque CRM/`](./Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/).

## Project

SaaS B2B multi-tenant. CRM com pipelines de vendas, campanhas, automações IA.
~30 organizações ativas. ICP: fábricas/distribuidoras B2B. Time: CTO + 1 dev
junior + agentes IA.

## Tech stack

- **Frontend**: React 18 + TypeScript 5.8 + Vite 5 (SWC)
- **UI**: shadcn/ui (Radix) + Tailwind 3 + Lucide icons
- **State**: TanStack Query v5 + React Context (auth/features)
- **Forms**: React Hook Form + Zod
- **Backend**: Supabase (Postgres + Auth + Edge Functions + Realtime + Storage)
- **AI**: Google Gemini (embeddings 1536d) + pgvector
- **WhatsApp**: Uazapi (provider-agnostic adapter)
- **Tests**: Vitest + Playwright
- **Monitoring**: Sentry

## Quick start

```bash
git clone https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2.git
cd v8milennialsb2bv2
npm install
git config core.hooksPath scripts/git-hooks
cp .env.example .env.local
npm run dev   # localhost:8080
```

## Build & Test

```bash
npm run dev               # Dev server
npm run build             # Production build
npm run test:unit         # Vitest unit
npm run test:integration  # Vitest + Supabase local
npm run test:e2e          # Playwright + Chromium
npm run lint              # ESLint
```

CI roda em PR: unit → integration → e2e → docker-image.

## Code style

- **TypeScript strict.** React 18 functional. Hooks first.
- **shadcn/ui + Tailwind.** Dark-first. HSL CSS vars. Accent gold `hsl(47 100% 50%)`.
- **Imports**: `@/` alias.
- **Naming**: Components `PascalCase`, hooks `useCamelCase`, tables `snake_case`,
  env `VITE_SCREAMING_SNAKE` (frontend) / `SCREAMING_SNAKE` (backend).
- **No console.log em prod.** `console.warn`/`error` esporádico.
- **Tipos Supabase**: `Tables<"leads">`, `TablesInsert<"leads">`,
  `TablesUpdate<"leads">` de `@/integrations/supabase/types`.

## Architecture

- **Multi-tenant by default.** Toda query filtra `organization_id`. RLS
  garante isolamento. Frontend nunca envia `org_id` — vem do auth context.
- **Permissions 3 camadas**: Master → Org Admin → Feature Permissions → Role
  Matrix. Roles: `admin`, `master`, `membro`.
- **Edge Function pattern**: `Deno.serve(withSentry('nome', handler))` +
  `withSecurityHeaders(getCorsHeaders(req))` + OPTIONS early return.
- **Cron via pg_cron + pg_net** → edge functions. Auth: `x-cron-secret` header.

C4 diagrams: [`docs/architecture/`](./docs/architecture/) (após F5).
Deep dive: [`Obsidian/.../02 — Arquitetura/`](./Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/02%20—%20Arquitetura/).

## Security

### Paths sensíveis (review obrigatório)

- `src/lib/permissions.ts`
- `supabase/functions/_shared/permission_engine.ts`
- `supabase/functions/_shared/whatsapp-client.ts`
- `supabase/migrations/` (RLS, POLICY, GRANT, ROLE)
- `src/contexts/Auth*.tsx`
- `src/integrations/supabase/client.ts`

### Não fazer

- Nunca editar `src/integrations/supabase/types.ts` manualmente
- Nunca usar `--no-verify-jwt` na CLI (use `verify_jwt = false` no config.toml)
- Nunca usar `SDR`/`Closer` como role no código — roles: `admin`/`master`/`membro`
- Nunca enviar service_role key no frontend
- Nunca editar migration que já rodou — criar nova
- Nunca commitar `.env` com credenciais reais

## Testing

- Unit tests cobrem hooks e lógica pura
- Integration tests rodam contra Supabase local (Docker)
- E2E tests rodam contra dev project com Playwright
- Tasks sensíveis (RLS, auth) exigem teste positivo + negativo

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <imperative description>

[optional body — explain why, not what]

[optional footer — refs, breaking changes, co-authors, flags]
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `security`, `perf`, `test`.
Common scopes: `auth`, `vault`, `chat`, `whatsapp`, `copilot`, `pipe`,
`permissions`, `workflows`, `campaigns`, `dashboard`, `webhooks`, `cron`,
`migrations`, `deps`, `ci`.

Examples:
```
feat(copilot): add reasoning audit page for master admin
fix(whatsapp-webhook): tolerate Uazapi V2 payload schema variations
docs(vault): register whatsapp stability state for handoff
```

## Branch model

```
main          ← prod. Push direto proibido. PR + review obrigatórios.
<type>/<slug> ← branch de trabalho. Nova por feature/fix.
```

Push em branch nova sempre. Nunca direto em `main`/`develop`.

## Deployment

- **Default = dev.** Produção exige autorização explícita do CTO **na sessão**.
- Frontend: push `main` → Docker → EasyPanel (VPS Hostinger)
- Edge functions: `supabase functions deploy <fn> --project-ref <ref>`
- Migrations: `supabase db push --linked --project-ref <ref>`
- Project refs: prod `jsjsmuncfkbsbzqzqhfq` · dev `bcfadphgsibjzivtbjvc`

## Vault

Project documentation lives in
[`Obsidian/Segundo Cerebro/Claude Code — Torque CRM/`](./Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/).

Structure (Diátaxis-aligned):

```
00 — INDEX.md          ← Map of content (start here)
01 — Identidade/       ← Team, conventions, subagents
02 — Arquitetura/      ← Explanation (why)
03 — Reference/        ← Lookup tables (what)
04 — Decisões/         ← ADRs (immutable decisions)
05 — How-to/           ← Operational procedures
06 — Features/         ← Domain rules
07 — Changelog/        ← Append-only history
08 — Backlog/          ← Work in progress
09 — Tutorials/        ← Learning material
99 — Templates/        ← Skeletons
```

**8-layer vault protection** in place (`.gitattributes` merge=union,
CODEOWNERS, `vault-sentinel` Action, pre-commit hook, PR template,
`vault-backup` mirror branch). Details in
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

To delete vault files: include `[vault-delete-ok]` flag in commit message.

## Áreas frágeis

🔴 Critical — extra care + tests obrigatórios:
- **Copilot** (IA agents) — `supabase/functions/agent-message/`, `_shared/copilot/`
- **WhatsApp** (Uazapi) — webhook + adapter + DLQ

🟠 High — review obrigatório:
- **Permissões** — `src/lib/permissions.ts`, `_shared/permission_engine.ts`
- **Pipelines + workflows** — sync entre tabelas, dedup triggers

Deep dive: [`Obsidian/.../02 — Arquitetura/Areas Frageis.md`](./Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/02%20—%20Arquitetura/Areas%20Frageis.md).

## Sub-CLAUDE.md (module-local context)

Critical modules têm `CLAUDE.md` local com contexto JIT:

- `supabase/functions/agent-message/CLAUDE.md` — Copilot turn
- `supabase/functions/whatsapp-webhook/CLAUDE.md` — Uazapi inbound
- `supabase/functions/_shared/CLAUDE.md` — Shared modules
- `supabase/migrations/CLAUDE.md` — Migration rules
- `src/lib/permissions/CLAUDE.md` (or equivalent) — Permissions engine

(Files added in F4 — verify presence before assuming.)

## Get help

- Doc primária: [`CLAUDE.md`](./CLAUDE.md) + vault
- Issues: GitHub Issues
- Contato: CTO (Gabriel) via canais internos
