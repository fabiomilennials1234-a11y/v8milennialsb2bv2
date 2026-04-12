---
tags:
  - claude-code
  - feature
  - torque-crm
  - admin
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Checkout e Planos

## O que faz

Wizard 3 steps (Plano → Org → Pagamento) para novos clientes. PIX QR ou card. Pricing dinamico com cupons, descontos volume, e addons. Provisioning automatico apos pagamento.

## Regras de negocio

- Pricing validado server-side (nunca confiar no frontend)
- Cupons aplicados antes de desconto volume
- Billing cycles: mensal, semestral, anual (com descontos progressivos)
- PIX QR expira em 1-2h
- Card cria subscription recorrente
- Provisioning automatico: org + team members + settings

## Como o usuario usa

1. Acessa pagina de checkout
2. Step 1: Seleciona plano (comparacao de features)
3. Step 2: Define nome da org, adiciona membros
4. Step 3: Escolhe pagamento (PIX ou card)
5. Confirmado → org pronta para uso

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Checkout.tsx` / `CheckoutSuccess.tsx` — Paginas
- `src/components/checkout/CheckoutWizard.tsx` — 3 steps
- `PlanSelector.tsx` — Step 1
- `OrgSetup.tsx` — Step 2
- `PaymentStep.tsx` — Step 3
- `CheckoutSummary.tsx` — Sidebar pricing
- `PixQRCode.tsx` — QR display

### Hooks

- `useCheckout()` — State machine (step, plan, billing, users, coupon, payment)

### Lib

- `src/lib/pricing-calculator.ts` — Plans, addons, discount structures

### Edge Functions

- `checkout-create-payment` — Cria customer Asaas, inicia pagamento
- `checkout-provision-org` — Provisiona org completa apos confirmacao

### Tabelas

- `subscription_plans` — base_price, price_per_user, min_users, features JSON, discounts
- `plan_addons` — Add-ons (Turbo copilot, extra users)
- `organizations` — payment_customer_id, payment_status

---

## Historico de mudancas

## Links relacionados

- [[Asaas Pagamentos]]
- [[Configuracoes]]
