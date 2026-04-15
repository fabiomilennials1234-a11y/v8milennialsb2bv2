---
tags:
  - claude-code
  - feature
  - torque-crm
  - vendas
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Produtos

## O que faz

Catalogo de produtos B2B com 3 tipos: MRR (recorrente), projeto, e unitario. Variantes (cor, tamanho, SKU) com pricing independente. Import via XLSX e sync com TinyERP.

## Regras de negocio

- Cada produto tem `ticket` (preco padrao) e `ticket_minimo` (desconto maximo permitido)
- Variantes herdam do produto mas podem ter ticket proprio
- Produtos vinculados a proposals via `pipe_proposta_items`
- Import XLSX segue template padrao (`src/lib/leadsImportTemplate.ts`)
- Sync TinyERP e bidirecional (import catalogo, export pedidos)

## Como o usuario usa

1. Abre Produtos no menu lateral
2. Ve grid de produtos com busca e filtros
3. Cria produto: nome, tipo (MRR/projeto/unitario), SKU, preco, variantes
4. Pode importar via XLSX
5. Pode anexar materiais (PDFs, contratos, links)
6. Produtos aparecem na criacao de propostas

## Edge cases

- Produto sem preco (ticket=0) permitido mas gera alerta
- Deletar produto nao remove de propostas existentes
- Sync TinyERP pode criar duplicatas se SKU nao bateu

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Produtos.tsx` - Grid de produtos
- `src/components/products/CreateProductModal.tsx` - Criar produto
- `src/components/products/EditProductModal.tsx` - Editar com variantes
- `src/components/products/ProductImportModal.tsx` - Import XLSX
- `src/components/products/ProductMaterialsSection.tsx` - Anexar materiais

### Hooks

- `useProducts.ts` - Lista produtos da org
- `useProductsWithVariants.ts` - Com variantes incluidas
- `useProductVariants.ts` - CRUD de variantes
- `useProductMaterials.ts` - Materiais vinculados
- `useProductRanking.ts` - Ranking por vendas
- `useDeleteProduct.ts` - Soft delete

### Edge Functions

- `tinyerp-sync-products` - Sync catalogo do ERP (paginado)

### Tabelas

- `products` - name, type (mrr/projeto/unitario), sku, ticket, ticket_minimo, entregaveis, materiais, links[], logo_url, contrato_padrao_url
- `product_variants` - sku, name, ticket, weight, grammage, dimensions, color, size, custom_attributes, sort_order
- `product_materials` - Links para PDFs, guias, contratos

### Fluxo de dados

```
Admin cria produto (ou sync TinyERP)
  → INSERT products + product_variants
    → Produto disponivel na criacao de propostas
      → User seleciona produto → INSERT pipe_proposta_items
        → Vendido → tinyerp-push-order usa product data
```

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Ranking]]

- [[Pipe Propostas]]
- [[TinyERP]]
- [[Upsell]]
