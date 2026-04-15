---
tags:
  - claude-code
  - feature
  - torque-crm
  - integracoes
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Asaas Pagamentos

## O que faz

Pagamentos via Asaas (processador brasileiro). PIX QR code ou credit card. Subscription billing com retry. Webhook atualiza status da org automaticamente.

## Regras de negocio

- checkout-create-payment valida pricing server-side (nao confiar no frontend)
- PIX gera QR code (expira 1-2h)
- Card cria subscription recorrente
- Webhook events: PAYMENT_CONFIRMED → provision org, PAYMENT_OVERDUE → suspende, PAYMENT_REFUNDED → cancela
- Billing cycles: mensal, semestral, anual

## Como o usuario usa

1. Checkout → seleciona plano → configura org → escolhe pagamento
2. PIX: escaneia QR → aguarda confirmacao
3. Card: insere dados → cobranca imediata
4. Confirmado → org provisionada automaticamente

---

## Como funciona (tecnico)

### Edge Functions

- `checkout-create-payment` - Cria customer Asaas, inicia pagamento (PIX QR ou card subscription)
- `asaas-webhook` - Recebe events (CONFIRMED/OVERDUE/REFUNDED/DELETED), atualiza org status, dispara provisioning
- `checkout-provision-org` - Cria org, team members, settings apos pagamento confirmado

### Shared

- `_shared/asaas.ts` - Client Asaas API

### Tabelas

- `organizations` - payment_customer_id, payment_subscription_id, payment_status (active/overdue/suspended/cancelled)
- `subscription_plans` - Planos e precos

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Webhooks]]

- [[Checkout e Planos]]
- [[Configuracoes]]
