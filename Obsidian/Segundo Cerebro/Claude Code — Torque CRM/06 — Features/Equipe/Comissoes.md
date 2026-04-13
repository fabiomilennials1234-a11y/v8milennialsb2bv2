---
tags:
  - claude-code
  - feature
  - torque-crm
  - equipe
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Comissoes

## O que faz

Comissoes por venda (MRR/Projeto), filtro por membro e mes, chart de tendencia mensal, status de pagamento (pago/pendente). Admin pode criar/editar manualmente.

## Regras de negocio

- Comissao vinculada a pipe_proposta (deal especifico)
- Tipo herda do produto (MRR ou Projeto)
- Gerada automaticamente ao mover proposta para vendido
- Admin pode criar/editar/deletar manualmente

## Como o usuario usa

1. Comissoes no menu lateral
2. Filtra por membro e mes/ano
3. Ve cards com deal name, valor, tipo, status pagamento
4. Chart mostra tendencia mensal
5. Admin pode adicionar comissao manual

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Comissoes.tsx` — Pagina principal
- `src/components/comissoes/CommissionChart.tsx` — Grafico tendencia

### Hooks

- `useCommissions(month?, year?)` — Todas da org
- `useCommissionsByMember(teamMemberId, month?, year?)` — Por membro
- `useCommissionSummary()` — Totais (total, pago, pendente)
- `useCreateCommission()` / `useUpdateCommission()` / `useDeleteCommission()` — CRUD

### Tabelas

- `commissions` — team_member_id, pipe_proposta_id, amount, type (MRR/Projeto), month, year, paid (boolean), organization_id

---

## Historico de mudancas

## Links relacionados

- [[Pipe Propostas]]
- [[Gestao de Time]]
