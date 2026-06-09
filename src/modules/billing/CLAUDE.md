# Module — billing

**Status:** 🟢 Active — subscription stable, superfície pequena (5 arquivos). Mantido como BC distinto por ser domínio com **alvo de expansão** se Asaas/Stripe ganhar nova superfície (multi-provider, plano custom, métricas de churn, etc.).
**BC:** billing
**Entidade primária:** Subscription Plan + Asaas Payment
**Owner:** finance / ops
**Decisão pós-modularização (fase 4 — 2026-05-28):** mantido separado (não absorvido em `platform`). Razão: edge functions Asaas/checkout (slice 14) crescem aqui; subscription é domínio financeiro distinto de settings de plataforma. Reavaliar se em 6 meses não houver edge function nova ou hook novo.

## Escopo

Faturamento e assinatura da plataforma Torque (não confundir com Order da carteira do cliente).

Inclui:
- Planos (Starter, Pro, Enterprise — definição em `subscription_plans`)
- Assinatura ativa por org (status: trial, active, overdue, suspended, cancelled, expired)
- Integração Asaas (gateway de pagamento brasileiro)
- Provisionamento de org após checkout
- Trial / grace period
- Cobrança recorrente
- Validação de cupom no checkout
- UX de cobrança (OverdueBanner, SubscriptionBlockedPage)

## Não-escopo

- Pagamento do cliente final da org → `carteira` (TinyERP integration)
- Comissões internas do time → `engagement`
- Gate de subscription para rotas → `@/modules/identity/components/SubscriptionProtectedRoute` (consome `billing.checkSubscription` + components `OverdueBanner` / `SubscriptionBlockedPage` via deep-import)
- Página `Configuracoes.tsx` (parte tem UI billing — split com `platform` definido em slice 14)

## Estrutura

```
src/modules/billing/
├── components/
│   └── subscription/         # ex-src/components/subscription/  (2 files)
│       ├── OverdueBanner.tsx
│       └── SubscriptionBlockedPage.tsx
├── hooks/
│   └── useCouponValidation.ts  # ex-src/hooks/useCouponValidation.ts
├── lib/
│   └── subscription.ts         # ex-src/lib/subscription.ts (RPC org_get_subscription_status)
├── index.ts                  # API pública (hooks + lib)
└── CLAUDE.md                 # este arquivo
```

## API pública (`index.ts`)

### Hooks
- `useCouponValidation` (+ `CouponResult` type)

### Lib (re-exportada como API estável)
- `checkSubscription(orgId)` → `SubscriptionStatus`
- `checkCurrentUserSubscription()` → `SubscriptionStatus | null`
- `getCurrentOrganization()`
- `SubscriptionStatus` (type)

### Components
NÃO re-exportados. `SubscriptionProtectedRoute` (em `identity`) faz deep-import legítimo:
- `@/modules/billing/components/subscription/OverdueBanner`
- `@/modules/billing/components/subscription/SubscriptionBlockedPage`

### Eventos (post slice 19)
- `subscription.activated`, `subscription.expired`, `payment.failed` (TBD slice 19)

## Áreas frágeis

🟠 **Asaas webhook idempotency** — só no backend (slice 14 edge functions). NÃO migrado nesta slice.

🟠 **Trial / grace period** — lógica em `lib/subscription.ts` cruza `daysRemaining`, `graceRemaining`, `isOverdue`, `isBlocked`. NÃO tocar comportamento sem auditar a RPC `org_get_subscription_status` (server-side).

🟠 **Fail-open em erro de transporte (desde 2026-06-09)** — `checkSubscription` faz retry curto e, persistindo erro de RPC (timeout/rede), devolve `status:'unknown'` com `isBlocked:false`. NUNCA assume `'expired'` por falha de transporte. O guard (`SubscriptionProtectedRoute`) trata `'unknown'`/`null` como fail-open e renderiza children. Razão: o guard é DISPLAY/UX — enforcement real é server-side (RLS). Bloquear cliente pagante por timeout é pior que liberar acesso a um guard cosmético. Bloqueio só nos terminais afirmados pelo DB (suspended/cancelled/expired sem `billing_override`). Regressão coberta em `tests/unit/subscription.test.ts`. Incidente: Grafica Cauta vista como "Assinatura Expirada" sob timeouts intermitentes de prod.

🟠 **Multi-tenancy + plan limits enforcement server-side** — depende da RPC; client-side é display only.

## Dependências cross-module

- `@/integrations/supabase/client` — RPC + auth
- (consumido por) `@/modules/identity/components/SubscriptionProtectedRoute` — gate de rota lê `checkSubscription` + components de UI

### Consumidores cross-module (importam de `@/modules/billing`)

- `@/modules/identity/components/SubscriptionProtectedRoute` — deep-import `lib/subscription` + `components/subscription/OverdueBanner` + `components/subscription/SubscriptionBlockedPage`
- `@/modules/copilot/hooks/useCopilotSubscription` — deep-import `lib/subscription` (`checkCurrentUserSubscription`)

## Decisões — slice 13

- **`src/components/branding/`** (TorqueLoader, V8Logo) — mencionado no skeleton anterior, MAS é UI cross-cutting (App.tsx, OnboardingGate, ProtectedRoute, Dashboard, Copilot). NÃO migrado nesta slice. Slice 17 decide destino (`src/ui/` ou `src/shared/`).
- **`SubscriptionProtectedRoute`** — JÁ está em `@/modules/identity` desde slice 3. NÃO movido pra billing. Ele depende de billing (lib + components UI), não o contrário.
- **`Configuracoes.tsx`** — fica em `src/pages/Configuracoes.tsx`. Slice 14 (platform) decide split entre billing/asaas/asaas-mgmt e platform/settings.
- **`src/lib/subscription.ts`** → movido para `src/modules/billing/lib/subscription.ts`. RPC server-side preserva comportamento.

## Dívidas técnicas

- 🟠 **Asaas edge functions + checkout-provision-org** — slice 14 (backend).
- 🟠 **Configuracoes.tsx** com UI mista (billing + platform settings) — slice 14 decide o split.

## Origem (slice 13 — frontend migrado em 2026-05-27)

Frontend (migrado pra cá):

- ~~`src/components/subscription/`~~ (2 files: OverdueBanner, SubscriptionBlockedPage) → `./components/subscription/`
- ~~`src/hooks/useCouponValidation.ts`~~ → `./hooks/useCouponValidation.ts`
- ~~`src/lib/subscription.ts`~~ → `./lib/subscription.ts`

Backend (próximas slices):

- `supabase/functions/checkout-provision-org/`, `asaas-*`, `cron-asaas-*` (slice 14)

## Slice de migração

**Slice 13** — `feat/modularizacao/12-billing-marketing` — completado 2026-05-27 (combinado com marketing).

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Slice de referência: slice 12 analytics (commit `06a1e63e`)
