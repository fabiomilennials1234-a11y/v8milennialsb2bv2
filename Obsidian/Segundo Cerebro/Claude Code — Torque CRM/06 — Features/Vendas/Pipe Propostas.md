---
tags:
  - claude-code
  - feature
  - torque-crm
  - vendas
created: 2026-04-12
last_updated: 2026-04-17
status: active
---

# Pipe Propostas

## O que faz

Kanban de propostas comerciais com produtos, calor (deal temperature 1-5), e commitment dates. Stages: marcar_compromisso → compromisso_marcado → proposta_enviada → esfriou → futuro → vendido → perdido.

## Regras de negocio

- Proposta tem line items (`pipe_proposta_items`) com produto, quantidade, preco unitario e valor total da linha
- Selecao de produto via combobox com busca por nome/SKU (Popover + Command)
- Quantidade padrao = 1 ao selecionar produto; preco unitario preenchido pelo ticket do produto
- Calor slider (1-5) indica probabilidade de fechamento
- Vendido auto-sync para TinyERP via `tinyerp-push-order`
- Metricas por periodo (mensal, trimestral)
- Commitment date rastreia quando o deal deve fechar
- Comissoes geradas automaticamente ao mover para vendido

### Responsabilidade e visibilidade (2026-04-17)

**Fonte de verdade dos responsáveis**: `leads.sdr_id`, `leads.closer_id`, `leads.responsible_id`.

**Pipes espelham leads** via trigger `trg_sync_responsible_from_lead_to_pipes`:
- Quando `leads.responsible_id`, `closer_id` ou `sdr_id` mudam, o trigger propaga para `pipe_whatsapp`, `pipe_confirmacao`, `pipe_propostas` (colunas aplicáveis) e `campanha_leads`.
- Antes do fix, só `responsible_id` era propagado — `pipe_propostas.closer_id` ficava apontando pro closer antigo após transferência, e a RLS SELECT (que lê `closer_id` do pipe) continuava liberando visibilidade pro closer antigo. Dois closers viam o mesmo lead.

**RLS SELECT de `pipe_propostas`** (última atualização 2026-08-26):
```sql
public.is_user_admin()
OR public.has_feature_permission('leads.view_all')
OR public.is_user_responsible(responsible_id)
OR public.can_see_lead_by_permissions(leads.sdr_id, pipe_propostas.closer_id)
```

**Invariantes mantidos**:
- Para todo registro `pipe_propostas`: `closer_id` == `leads.closer_id` (via trigger + backfill)
- Para todo registro `pipe_confirmacao`: `closer_id` == `leads.closer_id` e `sdr_id` == `leads.sdr_id`
- Para todo registro `pipe_whatsapp`: `sdr_id` == `leads.sdr_id`

**Filtro defensivo no frontend** (2026-04-17): [PipePropostas.tsx](../../../../src/pages/PipePropostas.tsx) e [PipeConfirmacao.tsx](../../../../src/pages/PipeConfirmacao.tsx) aplicam, na primeira visita de um usuário `member`, `filterResponsible = teamMemberId`. Camada extra além da RLS; admin e master começam com "all".

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

- `src/pages/PipePropostas.tsx` — Pagina principal
- `src/components/proposals/CreateProposalModal.tsx` — Criar proposta
- `src/components/proposals/ProductCombobox.tsx` — Combobox de produto com busca por nome/SKU
- `src/components/proposals/CalorSlider.tsx` — Slider de temperatura do deal
- `src/components/proposals/CommitmentDateModal.tsx` — Definir data de compromisso
- `src/components/proposals/TinyErpConfirmOrderDialog.tsx` — Confirmar sync ERP
- `src/components/proposals/CalorAnalyticsChart.tsx` — Grafico de calor
- `src/components/proposals/ProductAnalyticsChart.tsx` — Analytics por produto

### Hooks

- `usePipePropostas.ts` — queryKey: `["pipe_propostas", orgId]`, join com leads e products
- `usePipePropostasMetrics.ts` — Metricas por periodo
- `usePipePropostaItems.ts` — Line items da proposta
- `useTinyErp.ts` — Integracao ERP

### Edge Functions

- `tinyerp-push-order` — Sync vendido → cria customer + order no TinyERP
- `pipe-rule-dispatch` — Regras de stage
- `process-ai-actions` — Acoes IA (scoring, insights)

### Tabelas

- `pipe_propostas` — status, calor, commitment_date, lead_id, organization_id
- `pipe_proposta_items` — pipe_proposta_id, product_id, quantity, unit_price, sale_value (sale_value = qty * unit_price)
- `products` — Catalogo (type: mrr/projeto/unitario, ticket, ticket_minimo)
- `commissions` — Geradas ao mover para vendido

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

- [[Pipe Confirmacao]]
- [[Produtos]]
- [[TinyERP]]
- [[Comissoes]]
