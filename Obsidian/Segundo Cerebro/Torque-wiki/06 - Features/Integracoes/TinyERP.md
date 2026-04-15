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

# TinyERP

## O que faz

Sync catalogo de produtos do TinyERP (ERP brasileiro), push de pedidos (vendido → ERP), fetch de NFe. Connect/disconnect via API key.

## Regras de negocio

- Sync paginado (API do TinyERP tem limite de pagina)
- Deduplicacao via tinyerp_product_mappings (tinyerp_id ↔ product_id)
- Push order cria customer + order no ERP
- Push upsell order para clientes existentes
- Proxy reverso mantem credenciais server-side

## Como o usuario usa

1. Configuracoes → Integracoes → TinyERP
2. Conecta com API key
3. Clica "Sincronizar Produtos" → catalogo importado
4. Ao vender (pipe_propostas → vendido) → pedido enviado pro ERP automaticamente

---

## Como funciona (tecnico)

### Edge Functions

- `tinyerp-connect` / `tinyerp-disconnect` - Setup/teardown
- `tinyerp-sync-products` - Fetch paginado + upsert (dedup via mappings)
- `tinyerp-proxy` - Reverse proxy (credenciais server-side)
- `tinyerp-push-order` - Vendido → cria customer + order no TinyERP
- `tinyerp-push-upsell-order` - Pedido adicional para cliente existente
- `tinyerp-fetch-nfe` - Download NFe
- `tinyerp-webhook` - Recebe notificacoes de update do TinyERP

### Shared

- `_shared/tinyerp-utils.ts` - Utilitarios

### Tabelas

- `tinyerp_integrations` - access_token, is_active, organization_id
- `products` / `product_variants` - Catalogo sincronizado
- `tinyerp_product_mappings` - product_id, tinyerp_id, last_synced_at

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Webhooks]]

- [[Produtos]]
- [[Pipe Propostas]]
- [[Upsell]]
