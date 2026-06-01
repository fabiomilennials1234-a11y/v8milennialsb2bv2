---
type: reference
title: As-Is — Panorama Atual
status: active
created: 2026-05-26
tags: [remodelagem, as-is, diagnostico]
related: ["[[problemas-criticos]]", "[[duplicatas-mapeadas]]"]
---

# As-Is — Panorama Atual

Snapshot do codebase em 2026-05-26. Números crus, sem interpretação.

## Tamanho

| Camada | Volume |
|--------|--------|
| Frontend hooks (`src/hooks/`) | **223 arquivos** `.ts` (incluindo `.test.ts`) |
| Frontend components (`src/components/`) | **62 pastas/arquivos** no root |
| Frontend pages (`src/pages/`) | **47 pages** soltas no root |
| Edge functions (`supabase/functions/`) | **97 funções** soltas no root |
| Edge shared modules (`supabase/functions/_shared/`) | **63 arquivos/pastas** no root |
| Migrations (`supabase/migrations/`) | **322+** arquivos |
| TypeScript types (`src/integrations/supabase/types.ts`) | **270 KB** auto-gerado |

## Organização

### Frontend

```
src/
  hooks/         # 223 arquivos, 250+ no root, 4 subpastas (chat, chat-meta, lead, onboarding)
  components/    # 62 entradas no root, mistura pastas de domínio + arquivos soltos
  pages/         # 47 pages no root, naming inconsistente (PipePropostas vs Negocios)
  lib/           # utils + permissions + helpers
  integrations/  # supabase/types.ts + outros providers
  contexts/      # AuthContext, FeaturesContext
```

### Backend (Supabase)

```
supabase/
  functions/
    _shared/     # 63 módulos misturando workflow, message gateway, copilot, retention, permission
    <97 fns>/    # cada função no próprio diretório, sem agrupamento por domínio
  migrations/    # 322+ arquivos
```

## Pastas duplicadas por domínio

| Domínio | Pastas atuais |
|---------|---------------|
| Lead | `components/lead/` + `components/lead-detail/` + `components/leads/` |
| Pipeline | `components/pipelines/` + `pipe-propostas/` + `confirmacao/` + `kanban/` + `custom-pipelines/` + `funis/` (6 pastas) |
| Chat | `components/chat/` + `components/chat-meta/` (2 canais distintos — não é duplicata, mas compartilha primitives) |
| Carteira | `components/carteira/` + `upsell/` + `proposals/` + `deals/` (4 pastas) |
| Dashboard/Analytics | `components/analytics/` + `dashboard/` + `dashboard-outbound/` + `tv/` + `performance/` + `revisao/` (6 pastas) |
| Engagement | `components/agenda/` + `activities/` + `followups/` + `checklists/` + `calls/` + `gamification/` + `badges/` + `ranking/` (8 pastas) |
| Identity admin | `components/master/` + `team/` + `settings/equipe` (subpastas espalhadas) |

## Sub-CLAUDE.md existentes

Apenas **5 áreas frágeis** têm `CLAUDE.md` próprio:
- `supabase/functions/agent-message/` (Copilot turn)
- `supabase/functions/whatsapp-webhook/` (Uazapi inbound)
- `supabase/functions/_shared/`
- `supabase/migrations/`
- `src/lib/` (permissions)

Resto do codebase sem ownership documentado.

## Áreas frágeis declaradas (CLAUDE.md raiz)

| Área | Risco |
|------|-------|
| Copilot (agentes IA) | 🔴 Fluxo mais frágil. Edge cases: sem business_context, lead sem telefone, conversation sem messages |
| WhatsApp (Uazapi) | 🔴 Provider-agnostic via adapter. Migração Evolution→Uazapi recente. Múltiplos workers + DLQ |
| Permissões | 🟠 3 camadas (master → admin → feature → role). Issues recorrentes |

## Time

CTO (Gabriel) + 1 dev junior + 3 subagentes Claude Code (arquiteto, design, engenheiro).

Mental model do produto: **na cabeça do CTO**. Documentação parcial. Onboarding humano = oral history.

## Stack

React 18 + TS 5.8 + Vite 5 + shadcn/ui + Tailwind 3 + TanStack Query v5 + RHF + Zod.
Supabase (Postgres + Auth + Edge Functions Deno + Realtime + Storage) + pgvector.
Integrações: Uazapi, Meta, Google Calendar, TinyERP, Asaas, n8n, SZ.Chat, ElevenLabs.
Vitest + Playwright. Sentry.

## Tráfego

~30 organizações ativas. ICP: fábricas/distribuidoras B2B. Domínio `torquecrm.com.br`.

## Refs

- CONTEXT.md (glossário 14 BCs): `/CONTEXT.md`
- `.specs/codebase/STRUCTURE.md`
- CLAUDE.md raiz do projeto
