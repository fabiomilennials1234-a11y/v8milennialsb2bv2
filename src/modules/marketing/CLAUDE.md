# Module — marketing

**Status:** 🟢 Active (slice 13 — frontend popular completo. Edge functions lead-webhook/meta-* ficam em slice 14)
**BC:** marketing
**Entidade primária:** Lead Form + Landing Page + UTM
**Owner:** marketing / vendas

## Escopo

Captura pública de leads + tracking de origem. Inclui:

- **Landing page** — página pública configurável por org (Hero, Showcase, Pricing, FAQ, Footer, etc.)
- **Lead Forms** — formulários embedáveis (iframe ou JS) — TBD backend slice 14
- **UTM tracking** — utm_source, utm_medium, utm_campaign, utm_content
- **Cadastro externo** — endpoint público pra n8n/Meta Ads/Zapier
- **Mkt por origem** — UI de display/config de origens (UTM tagging, ranking, breakdown)
- **Animations** (landing) — visuals da landing page

## Não-escopo

- Score do lead após captura → `leads.useLeadScore`
- Placement em pipe → `pipelines`
- Atribuição de SDR → `identity` (round-robin)
- Meta Ads insights → `analytics.useAnalyticsUtms`
- `src/components/branding/` (TorqueLoader, V8Logo) — UI cross-cutting, slice 17 decide destino

## Estrutura

```
src/modules/marketing/
├── components/
│   ├── landing/             # ex-src/components/landing/   (17 files — Hero, Showcase, Pricing, FAQ, Footer, etc.)
│   └── marketing/           # ex-src/components/marketing/ (4 files — Mkt* consumidos por analytics)
├── hooks/
│   ├── useLandingAnimations.ts   # ex-src/hooks/useLandingAnimations.ts
│   └── useCadastroExterno.ts     # ex-src/hooks/useCadastroExterno.ts (cross-domain)
├── pages/
│   └── Landing.tsx          # ex-src/pages/Landing.tsx (rota `/`)
├── index.ts                 # API pública (hooks + Mkt* components)
└── CLAUDE.md                # este arquivo
```

## API pública (`index.ts`)

### Hooks
- `useLandingAnimations(containerRef)` — animações IO da landing page
- `useCadastroExternoEnabled()` — feature flag (consumido por carteira/leads/pipelines)
- `useCadastroExternoPush()` — mutation pra POST externo (consumido por carteira/leads)
- `CadastroExternoPushPayload`, `CadastroExternoPushResult` (types)

### Components
- `MktConfigModal`, `MktOriginCard`, `MktOriginRanking`, `MktUtmBreakdown` — consumidos por `analytics.AquisicaoSection` (UI de display/config de Mkt por origem)

Components da landing (`HeroSection`, `LandingNavbar`, etc.) NÃO são re-exportados — usados apenas pela `Landing` page do próprio módulo.

### Pages
NÃO re-exportadas — App.tsx faz deep-import via React.lazy:
- `@/modules/marketing/pages/Landing` (rota `/`)

### Eventos (post slice 19)
- `lead.captured` (via webhook), `form.submitted` (TBD slice 19)

## Áreas frágeis

🟠 **Webhook `lead-webhook`** — backend (slice 14). Aceita múltiplos formatos (n8n, Meta Ads direto, Zapier). Tags em payload: array, JSON string, ou string simples (case-insensitive). `update_existing_if_match` dedup pelo telefone/email. NÃO migrado nesta slice.

🟠 **`useCadastroExterno`** — 6 consumers cross-domain (carteira, leads, pipelines). Mudança de assinatura impacta múltiplos módulos. Manter contract estável.

## Dependências cross-module

- `@/integrations/supabase/client` — auth + RPC
- (importado por marketing) — n/a (módulo standalone na frontend)

### Consumidores cross-module (importam de `@/modules/marketing`)

- `@/modules/analytics/components/analytics/sections/AquisicaoSection.tsx` — consome `MktConfigModal`, `MktOriginCard`, `MktOriginRanking` (via deep-import)
- `@/modules/carteira/components/proposal/CadastroExternoConfirmDialog.tsx` — `useCadastroExternoPush`
- `@/modules/leads/components/lead-detail/cross-pipe/BudgetFieldBlock.tsx` — `useCadastroExternoEnabled`
- `@/modules/leads/components/leads/funnel-contexts/PropostasContext.tsx` — `useCadastroExternoEnabled`
- `@/modules/pipelines/pages/PipePropostas.tsx` — `useCadastroExternoEnabled`

## Decisões — slice 13

- **`src/components/branding/`** (TorqueLoader, V8Logo) — skeleton anterior mencionava marketing como destino. Auditoria mostrou consumers cross-cutting (App.tsx, OnboardingGate, ProtectedRoute, Dashboard, Copilot). NÃO movido nesta slice. Slice 17 decide destino (`src/ui/` ou `src/shared/`). Ref removida do CLAUDE.md.
- **`useCadastroExterno`** confirmado em marketing (entry point externo + feature flag). 6 consumers atualizados via codemod.
- **Mkt* components** ficam em marketing mesmo sendo consumidos exclusivamente por analytics (são UI de domínio marketing — display de UTM/origem, não métrica). Re-export via barrel para acesso público.
- **Pages Landing** mantida como page única do módulo (Landing page pública). App.tsx atualizado.

## Dívidas técnicas

- 🟠 **Mkt* components only consumidos por analytics** — se padrão se mantiver, considerar mover pra analytics em slice 17 (ou virar slots/render-props com data injetado). Por ora ficam em marketing por afinidade de domínio.
- 🟠 **Lead Forms backend** — slice 14 edge functions (lead-webhook, list-lead-forms, cadastro-externo-push, meta-webhook, meta-oauth-callback, refresh-meta-tokens).

## Origem (slice 13 — frontend migrado em 2026-05-27)

Frontend (migrado pra cá):

- ~~`src/components/landing/`~~ (17 files) → `./components/landing/`
- ~~`src/components/marketing/`~~ (4 files: MktConfigModal, MktOriginCard, MktOriginRanking, MktUtmBreakdown) → `./components/marketing/`
- ~~`src/hooks/useLandingAnimations.ts`~~ → `./hooks/useLandingAnimations.ts`
- ~~`src/hooks/useCadastroExterno.ts`~~ → `./hooks/useCadastroExterno.ts`
- ~~`src/pages/Landing.tsx`~~ → `./pages/Landing.tsx`

Backend (próximas slices):

- `supabase/functions/lead-webhook/`, `meta-webhook/`, `list-lead-forms/`, `cadastro-externo-push/`, `refresh-meta-tokens/`, `meta-oauth-callback/` (slice 14)

## Slice de migração

**Slice 13** — `feat/modularizacao/12-billing-marketing` — completado 2026-05-27 (combinado com billing).

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Webhook payload spec: CLAUDE.md raiz (seção "Webhook lead-webhook")
- Slice de referência: slice 12 analytics (commit `06a1e63e`)
