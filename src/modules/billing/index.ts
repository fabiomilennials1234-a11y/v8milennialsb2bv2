/**
 * Module billing — API pública.
 *
 * Public surface do bounded context (faturamento + assinatura da plataforma).
 * Tudo cross-module passa por aqui. Internals (components/, lib/) são privados —
 * ESLint `boundaries` impede import direto fora da API pública.
 *
 * Status: Active (populado em slice 13 — feat/modularizacao/12-billing-marketing).
 *
 * Domínios cobertos:
 * - Subscription status (trial, active, overdue, suspended, cancelled, expired)
 * - Asaas payment gateway integration (verificação via RPC server-side)
 * - Cupons de desconto (validação no checkout)
 * - Overdue banner + Blocked page (UX de cobrança)
 *
 * Components NÃO são re-exportados — consumidores fazem deep-import quando
 * legítimo (ex.: SubscriptionProtectedRoute do identity importa OverdueBanner
 * + SubscriptionBlockedPage via @/modules/billing/components/subscription/...).
 */

// ────────────────────────────────────────────────────────────────────────
// Hooks — Validação de cupom
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useCouponValidation";

// ────────────────────────────────────────────────────────────────────────
// Lib — Subscription status (RPC org_get_subscription_status)
// ────────────────────────────────────────────────────────────────────────

export * from "./lib/subscription";

// ────────────────────────────────────────────────────────────────────────
// Proposta de pagamento (SCRUM-286/288) — cotação, links e as regras puras
//
// A TELA que consome isto mora no `identity/master`, porque é operação de
// Master: gerar proposta é autoridade dele, não superfície de billing do
// cliente. O que fica aqui é o que é do domínio de faturamento — cotar preço,
// montar o link, comparar o pacote com o plano base, ler o piso de assentos —
// e é por isso que atravessa pelo barrel, e não por deep-import.
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useBillingQuote";
export * from "./hooks/usePaymentLinks";
export * from "./lib/package-diff";
export * from "./lib/seats";
