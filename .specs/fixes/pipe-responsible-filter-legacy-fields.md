# fix: filtro de responsável do kanban ignora campos legacy/assigned_to

**Issue:** #765
**Tipo:** bug (pipes de sistema — WhatsApp / Confirmação / Propostas)
**Origem:** auditoria do incidente Basic4u (lead Dr. Luiz Dias). Classe de bug: lead com vínculo só-legacy some do board filtrado por membro.

## Problema

Filtro de responsável só reconhece dual (`pre_sale_responsible_id`, `sale_responsible_id`). Vínculo só via legacy (`responsible_id`/`sdr_id`/`closer_id`) ou `pipeline_entries.assigned_to` → lead excluído do kanban filtrado por membro. Duplicado em 3 pontos:

1. RPC `get_pipeline_page` — predicado `p_responsible_id` só dual (entry metadata + lead).
2. RPC `get_pipeline_stage_counts` — mesmo predicado (contagem das colunas diverge dos itens se mudar só um).
3. `matchesResponsibleFilter` (`src/lib/kanban-filters.ts`) — refiltro client-side, idem.

`assigned_to` não entra em nenhum.

## Contexto / decisão

Fase A (Issue #214 / PRD #211) descomissionou legacy de propósito (evitar contaminação de crédito de orgs com `responsible_id` errado). Reintroduzir legacy reabre isso. Caminhos:

1. **(preferida)** Backfill dual 100% + incluir `assigned_to` como fallback canônico no predicado. Auditar orgs com dual NULL + vínculo legacy/`assigned_to`; backfill dirigido.
2. Incluir legacy só quando dual é NULL (`COALESCE`-style), aceitando risco documentado.
3. Banner no board quando há entries com responsável só-legacy não-filtráveis (torna o buraco visível).

## Aceite

- Lead com responsável em qualquer campo canônico (dual + `assigned_to`) aparece no board filtrado do membro.
- `get_pipeline_page` e `get_pipeline_stage_counts` com **o mesmo** predicado (contagem = itens).
- Auditoria de orgs com dual NULL + vínculo legacy documentada.

## Arquivos

- RPC `get_pipeline_page` (migration nova)
- RPC `get_pipeline_stage_counts` (migration nova — sincronizar com page)
- `src/lib/kanban-filters.ts`
- `src/modules/pipelines/pages/PipeConfirmacao.tsx` (membro default filter)
- possível script de backfill dual dirigido
