# Module — billing

**Status:** 🟡 Skeleton (slice 13 popula)
**BC:** billing
**Entidade primária:** Subscription Plan + Asaas Payment
**Owner:** finance / ops

## Escopo

Faturamento e assinatura da plataforma Torque (não confundir com Order da carteira do cliente).

Inclui:
- Planos (Starter, Pro, Enterprise — definição em `subscription_plans`)
- Assinatura ativa por org
- Integração Asaas (gateway de pagamento brasileiro)
- Provisionamento de org após checkout
- Trial / grace period
- Cobrança recorrente
- Quota / seat usage (cross-cut com `identity`)

## Não-escopo

- Pagamento do cliente final da org → `carteira` (TinyERP integration)
- Comissões internas do time → `engagement`

## API pública (`index.ts`) — TBD slice 13

Provável superfície:
- Hooks: `useSubscription` (existir?), `useCouponValidation`
- Components: `<SubscriptionProtectedRoute>` (talvez stay em `identity`), `<UpgradeBanner>`
- Types: `SubscriptionPlan`, `BillingStatus`
- Eventos (post slice 19): `subscription.activated`, `subscription.expired`, `payment.failed`

## Áreas frágeis

- Asaas webhook idempotency
- Trial expiration grace period — quanto tempo lead/data fica acessível pós-cancel?
- Multi-tenancy + plan limits enforcement server-side

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/subscription/`
- `src/hooks/useCouponValidation.ts`
- `src/lib/subscription.ts`
- `src/pages/Configuracoes.tsx` (parte de billing — auditar split com `platform`)
- `src/components/SubscriptionProtectedRoute.tsx` (avaliar — pode ficar em `identity`)

Backend:
- `supabase/functions/checkout-provision-org/` (não encontrado na lista atual — verificar nome real)
- Asaas webhooks/edge functions (auditar — qual filename real?)

## Slice de migração

**Slice 13** — `feat/modularizacao/12-billing-marketing` (3h compartilhado com marketing)

## Dedup pendente

- Confirmar quais edge functions de billing realmente existem hoje (Asaas integration espalhada?)

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
