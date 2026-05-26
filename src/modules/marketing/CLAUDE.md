# Module — marketing

**Status:** 🟡 Skeleton (slice 13 popula)
**BC:** marketing
**Entidade primária:** Lead Form + Landing Page + UTM
**Owner:** marketing / vendas

## Escopo

Captura pública de leads + tracking de origem. Inclui:

- **Landing page** — página pública configurável por org
- **Lead Forms** — formulários embedáveis (iframe ou JS)
- **UTM tracking** — utm_source, utm_medium, utm_campaign, utm_content
- **Cadastro externo** — endpoint público pra n8n/Meta Ads/Zapier
- **Webhook lead** — recebe lead de fontes externas
- **Animations** (landing) — visuals da landing page

## Não-escopo

- Score do lead após captura → `leads.useLeadScore`
- Placement em pipe → `pipelines`
- Atribuição de SDR → `identity` (round-robin)
- Meta Ads insights → `analytics.useAnalyticsUtms`

## API pública (`index.ts`) — TBD slice 13

Provável superfície:
- Hooks: `useLandingAnimations`, `useCadastroExterno`
- Components: `<LandingPage>`, `<LeadCaptureForm>`
- Types: `LeadForm`, `UTM`
- Eventos (post slice 19): `lead.captured` (via webhook), `form.submitted`

## Áreas frágeis

- Webhook `lead-webhook` aceita múltiplos formatos de payload (n8n, Meta Ads direto, Zapier)
- Tags em payload: array, JSON string, ou string simples (case-insensitive)
- `update_existing_if_match` — dedup pelo telefone/email

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/landing/`, `marketing/`, `branding/`
- `src/hooks/useLandingAnimations.ts`, `useCadastroExterno.ts`
- `src/pages/Landing.tsx`

Backend:
- `supabase/functions/lead-webhook/` (compartilhado com `leads` — atribuição decidir slice 13)
- `supabase/functions/meta-webhook/` (compartilhado com `communication` Meta — webhook recebe events Meta)
- `supabase/functions/list-lead-forms/`
- `supabase/functions/cadastro-externo-push/`
- `supabase/functions/refresh-meta-tokens/`
- `supabase/functions/meta-oauth-callback/`

## Slice de migração

**Slice 13** — `feat/modularizacao/12-billing-marketing` (3h compartilhado com billing)

## Dedup pendente

- `lead-webhook` mora em `leads` ou `marketing`? Captura = `marketing`. Persistência = `leads`. Decidir em slice 13.

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Webhook payload spec: CLAUDE.md raiz (seção "Webhook lead-webhook")
