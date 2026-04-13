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

# Upsell

## O que faz

Modulo de pos-venda e upsell com 2 kanbans: "Tempo de Venda" (ciclo de venda do cliente) e "Gestao" (segmentacao por potencial e crescimento). Auto-move baseado em historico de pedidos e regras configuraveis.

## Regras de negocio

- Clientes segmentados por `potential` (low/med/high) e `growth` (low/med/high)
- `base_status`: prospectar → entrar → explorar → crescer → manter → reativar
- Auto-move via stage rules (ex: se pedido > threshold, mover para proxima stage)
- Integra com TinyERP para pedidos reais
- Campanhas de upsell por cliente (produto foco, datas)

## Como o usuario usa

1. Abre Upsell no menu lateral
2. Tab "Tempo de Venda" → kanban por ciclo de venda
3. Tab "Gestao" → kanban por potencial/crescimento
4. Pode criar cliente manualmente ou importar
5. Registra vendas (NovaVendaModal)
6. Ve stats de base (KPIs)
7. Configura regras de auto-move

## Edge cases

- Cliente sem pedidos historicos nao tem growth calculado
- Auto-move pode mover cliente que foi movido manualmente
- TinyERP push upsell order falha se integracao desconectada

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Upsell.tsx` — Pagina com 2 tabs
- `src/components/upsell/UpsellBaseKanban.tsx` — Kanban "Tempo de Venda"
- `src/components/upsell/UpsellGestaoKanban.tsx` — Kanban "Gestao"
- `src/components/upsell/CreateClientModal.tsx` — Adicionar cliente
- `src/components/upsell/NovaVendaModal.tsx` — Registrar venda
- `src/components/upsell/UpsellStats.tsx` — KPIs da base
- `src/components/upsell/ClientDetailModal.tsx` — Detalhe do cliente

### Hooks

- `useUpsellClients.ts` — Lista clientes da base
- `useUpsellClientProducts.ts` — Produtos do cliente
- `useUpsellOrders.ts` — Historico de pedidos
- `useUpsellMetrics.ts` — Metricas de pipeline
- `useUpsellGestaoRules.ts` — Regras de auto-move
- `useAutoMoveUpsellClients.ts` — Aplica regras
- `useUpsellCampanhas.ts` — Campanhas por cliente

### Edge Functions

- `tinyerp-push-upsell-order` — Sync pedido upsell para ERP
- `process-pipe-distribution` — Distribuicao de clientes

### Tabelas

- `upsell_clients` — name, company, phone, email, potential, growth, cliente_desde, base_status
- `upsell_orders` — order_value, order_date, linked to TinyERP
- `upsell_campanhas` — product focus, start/end dates per client
- `upsell_stage_rules` — auto-move logic (threshold → next stage)

### Fluxo de dados

```
Cliente adicionado (manual ou apos vendido no pipe_propostas)
  → INSERT upsell_clients (base_status: prospectar)
    → useAutoMoveUpsellClients aplica regras periodicamente
      → Se pedido recente > threshold → mover stage
        → Nova venda → tinyerp-push-upsell-order → sync ERP
```

---

## Historico de mudancas

## Links relacionados

- [[Produtos]]
- [[TinyERP]]
- [[Pipe Propostas]]
