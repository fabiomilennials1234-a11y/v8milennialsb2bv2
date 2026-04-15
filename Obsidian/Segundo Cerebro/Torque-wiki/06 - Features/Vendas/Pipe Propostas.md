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

# Pipe Propostas

## O que faz

Kanban de propostas comerciais com produtos, calor (deal temperature 1-5), e commitment dates. Stages: marcar_compromisso → compromisso_marcado → proposta_enviada → esfriou → futuro → vendido → perdido.

## Regras de negocio

- Proposta tem line items (`pipe_proposta_items`) com produto e valor de venda
- Calor slider (1-5) indica probabilidade de fechamento
- Vendido auto-sync para TinyERP via `tinyerp-push-order`
- Metricas por periodo (mensal, trimestral)
- Commitment date rastreia quando o deal deve fechar
- Comissoes geradas automaticamente ao mover para vendido

## Como o usuario usa

1. Lead chega do pipe_confirmacao (compareceu)
2. Cria proposta com produtos e valores (CreateProposalModal)
3. Define commitment date e calor
4. Move entre stages conforme negociacao avanca
5. Vendido → sync ERP + gera comissao
6. Perdido → registra motivo

## Edge cases

- Proposta sem produtos tem valor zero
- TinyERP sync falha se integracao nao configurada (silencioso)
- Calor analytics precisa de historico para ser significativo

---

## Como funciona (tecnico)

### Componentes

- `src/pages/PipePropostas.tsx` - Pagina principal
- `src/components/proposals/CreateProposalModal.tsx` - Criar proposta
- `src/components/proposals/CalorSlider.tsx` - Slider de temperatura do deal
- `src/components/proposals/CommitmentDateModal.tsx` - Definir data de compromisso
- `src/components/proposals/TinyErpConfirmOrderDialog.tsx` - Confirmar sync ERP
- `src/components/proposals/CalorAnalyticsChart.tsx` - Grafico de calor
- `src/components/proposals/ProductAnalyticsChart.tsx` - Analytics por produto

### Hooks

- `usePipePropostas.ts` - queryKey: `["pipe_propostas", orgId]`, join com leads e products
- `usePipePropostasMetrics.ts` - Metricas por periodo
- `usePipePropostaItems.ts` - Line items da proposta
- `useTinyErp.ts` - Integracao ERP

### Edge Functions

- `tinyerp-push-order` - Sync vendido → cria customer + order no TinyERP
- `pipe-rule-dispatch` - Regras de stage
- `process-ai-actions` - Acoes IA (scoring, insights)

### Tabelas

- `pipe_propostas` - status, calor, commitment_date, lead_id, organization_id
- `pipe_proposta_items` - pipe_proposta_id, product_id, sale_value
- `products` - Catalogo (type: mrr/projeto/unitario, ticket, ticket_minimo)
- `commissions` - Geradas ao mover para vendido

### Fluxo de dados

```
Lead compareceu no pipe_confirmacao
  → INSERT pipe_propostas (stage: marcar_compromisso)
    → Cria proposta com items (produtos + valores)
      → Negocia: move entre stages, ajusta calor
        → Vendido → tinyerp-push-order → gera comissao
        → Perdido → registra motivo
```

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Pipe Confirmacao]]
- [[Produtos]]
- [[TinyERP]]
- [[Comissoes]]
