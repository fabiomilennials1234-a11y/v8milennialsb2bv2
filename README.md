# Torque CRM

SaaS B2B multi-tenant para gestão de leads, pipelines de vendas, campanhas e
automações com IA. Produto da Milennials. Domínio:
[torquecrm.com.br](https://torquecrm.com.br).

## Quick start

```bash
git clone https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2.git
cd v8milennialsb2bv2
npm install
git config core.hooksPath scripts/git-hooks   # vault protection hook
cp .env.example .env.local                     # preencher credenciais dev
npm run dev                                    # localhost:8080
```

## Stack

React 18 + TypeScript 5.8 + Vite 5 (SWC) · shadcn/ui + Tailwind 3 ·
TanStack Query v5 · Supabase (Postgres + Auth + Edge Functions + Realtime
+ Storage) · Google Gemini (embeddings + pgvector) · Uazapi (WhatsApp).

## Comandos

| Comando | Descrição |
|---|---|
| `npm run dev` | Dev server (localhost:8080) |
| `npm run build` | Build produção |
| `npm run test:unit` | Vitest unit |
| `npm run test:integration` | Vitest + Supabase local |
| `npm run test:e2e` | Playwright |
| `npm run lint` | ESLint |

## Documentação

| Audiência | Doc |
|---|---|
| **Devs humanos** | Este README + [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| **Agentes IA (Claude Code)** | [`CLAUDE.md`](./CLAUDE.md) |
| **Agentes IA (agnostic)** | [`AGENTS.md`](./AGENTS.md) |
| **LLM crawlers** | [`llms.txt`](./llms.txt) |
| **Vault profundo** | [`Obsidian/Segundo Cerebro/Claude Code — Torque CRM/00 — INDEX.md`](./Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/00%20—%20INDEX.md) |
| **Arquitetura visual** | [`docs/architecture/`](./docs/architecture/) (C4 mermaid) |

### Tutorial pra dev novo

[`01-onboarding-dev`](./Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/09%20—%20Tutorials/01-onboarding-dev.md)
no vault — setup completo em ~90min.

## Segurança

- Nunca commitar `.env*` com credenciais reais
- Nunca editar `src/integrations/supabase/types.ts` manualmente (auto-gerado)
- Deploy em produção exige autorização explícita CTO na sessão
- Vault Obsidian tem 8 camadas de proteção contra perda — ver
  [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## Deploy

Frontend: push `main` → Docker → EasyPanel (VPS Hostinger).
Edge functions: `supabase functions deploy <fn> --project-ref <ref>`.
Migrations: `supabase db push --linked --project-ref <ref>`.

Project refs: `jsjsmuncfkbsbzqzqhfq` (prod) · `bcfadphgsibjzivtbjvc` (dev).

## Time

CTO Gabriel + 1 dev junior + 3 subagentes Claude Code
(`arquiteto`, `design`, `engenheiro`) — ver
[`Obsidian/.../01 — Identidade/Subagentes.md`](./Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/01%20—%20Identidade/Subagentes.md).

## Licença

Privado. Todos os direitos reservados.
