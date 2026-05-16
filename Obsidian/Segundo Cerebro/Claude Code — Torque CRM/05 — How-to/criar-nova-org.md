---
type: howto
title: Criar Nova Organização
status: draft
created: 2026-05-15
updated: 2026-05-15
tags: [howto, onboarding, org]
related: ["[[Multi-tenancy]]"]
owner: gabriel
---

# Como criar nova organização

> Fluxo via UI (recomendado) ou via edge function direta.

## Via UI — Checkout wizard

1. `/onboarding` ou `/checkout` no app
2. Wizard 6 steps: dados org → plano → pagamento → admin user → preferences → WhatsApp
3. Backend chama `checkout-provision-org` que cria:
   - row em `organizations`
   - row em `subscription_plans` link
   - admin user em `auth.users` + `organization_members` (role: admin)
   - default settings em `organization_settings`

## Via edge function (admin / master only)

```bash
curl -X POST https://<project>.supabase.co/functions/v1/checkout-provision-org \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Empresa Exemplo",
    "domain": "exemplo.com.br",
    "plan_id": "<plan-uuid>",
    "admin_email": "admin@exemplo.com.br",
    "admin_password": "<senha-temporária>"
  }'
```

## Adicionar usuário a org existente

```bash
curl -X POST https://<project>.supabase.co/functions/v1/create-org-user \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "organization_id": "<org-uuid>",
    "email": "novo@exemplo.com.br",
    "role": "membro",
    "password": "<senha-temporária>"
  }'
```

## Configurar WhatsApp

Após org criada:
1. `/configuracoes/whatsapp` → criar instância Uazapi
2. Conectar via QR code
3. Configurar webhook (automático após connect)
4. Testar envio de msg

## Gotchas

- **`organization_id` propaga em FKs** — sequence importante (org → user → instance).
- **Plano tem quota** (max usuários, max FAQs, etc.). Erro silencioso se exceder.
- **Default settings** definem features ativas. Conferir após criação.

(stub — expandir com edge cases conforme suporte real)
