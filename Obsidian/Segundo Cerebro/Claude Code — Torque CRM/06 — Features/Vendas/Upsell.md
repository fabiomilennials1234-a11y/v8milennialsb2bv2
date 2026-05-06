# Upsell

## O que e

Modulo de pos-venda e gestao de carteira de clientes. Permite acompanhar clientes que ja compraram, gerenciar potencial de upsell/cross-sell, e organizar carteiras por tempo de relacionamento (Base) ou por gestao ativa (Gestao).

## Como funciona

1. **Carteira Base (`upsell_base`)**: Kanban organizado por tempo desde a primeira venda (`tipo_cliente_tempo`). Stages: novo, 0-3m, 3-6m, 6-12m, 12m+.
2. **Carteira Gestao (`upsell_gestao`)**: Kanban de gestao ativa com stages customizaveis.
3. **Import via planilha**: `ImportUpsellClientsContent.tsx` — aceita CSV/XLSX, mapeamento de colunas invertido (campo sistema -> coluna arquivo), deduplicacao por telefone, resolucao fuzzy de vendedor/stage/potencial.
4. **Lead vinculado**: Cada `upsell_client` aponta para um `lead` via `lead_id` (FK RESTRICT). Se o lead nao existe, e criado no import.

### Arquivos chave
- `src/components/upsell/ImportUpsellClientsContent.tsx` — Import wizard (upload -> sheet -> map -> preview -> importing -> complete)
- `src/hooks/useUpsellClients.ts` — CRUD hooks (useUpsellClients, useCreateUpsellClient, useUpdateUpsellClient, useDeleteUpsellClient)
- `src/hooks/useLeads.ts` — `cleanupLeadDependencies()` limpa upsell tables antes de deletar leads
- `supabase/migrations/20260500000000_upsell_module.sql` — Schema (upsell_clients, upsell_orders, upsell_client_products, upsell_campanhas)

## Regras de negocio

- `upsell_clients.lead_id` tem `ON DELETE RESTRICT` — intencional, nao mudar para CASCADE. Cleanup explicito via `cleanupLeadDependencies`.
- Deduplicacao no import: por telefone formatado (55 + DDD + numero). Se lead ja existe com mesmo phone, reutiliza. Se upsell_client ja existe para esse lead, conta como duplicata.
- Potencial: baixo, medio, alto, estrategico. Aliases aceitos no import (ex: "high" -> "alto", "vip" -> "estrategico").
- Stage key fallback: se `selectedStageKey` esta vazio e planilha nao tem coluna Etapa, usa o primeiro stage da lista.

## Edge cases

- **Delete de lead com upsell_client**: Precisa deletar `upsell_orders`, `upsell_campanhas`, `upsell_client_products`, `upsell_clients` ANTES do lead. `cleanupLeadDependencies` cuida disso.
- **Import com erros**: Erros por linha sao trackados e exibidos em UI collapsible no step "complete". Row number e 1-indexed (header = row 1).
- **Stages vazio/loading**: Fallback para primeiro stage da lista. Se lista vazia, stage key fica "".

## Areas frageis

- **FK RESTRICT**: Se novas tabelas forem adicionadas com FK para `upsell_clients` ou `leads`, `cleanupLeadDependencies` precisa ser atualizada.
- **Bulk delete**: `deleteLeadsAndRelated` usa `cleanupLeadDependencies` internamente. Qualquer mudanca na ordem de delecao afeta single e bulk.

## Historico
- 2026-05-06 — Fix delete de leads com upsell entries (FK violation). Extraida `cleanupLeadDependencies`. Adicionado error tracking por linha no import. Fix fallback stage key.
