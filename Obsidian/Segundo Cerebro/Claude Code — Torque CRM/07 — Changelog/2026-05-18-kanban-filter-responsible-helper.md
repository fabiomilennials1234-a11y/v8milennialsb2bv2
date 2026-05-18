---
type: changelog
date: 2026-05-18
tags: [bugfix, vendas, pipelines, filtros, multi-tenancy-ui]
---

# 2026-05-18 — Filtro "Responsável" do kanban ignorava `pre_sale_responsible_id`

## Mudanças

- **Vendas / Pipes (WhatsApp, Confirmação, Propostas)**: o filtro "Responsável" do `KanbanFilterPanel` agora considera **todos os 9 campos** de responsabilidade — entry (4: `responsible_id`, `sdr_id`, `pre_sale_responsible_id`, `sale_responsible_id`) e lead (5: `responsible_id`, `sdr_id`, `closer_id`, `pre_sale_responsible_id`, `sale_responsible_id`). Antes, cada página tinha uma versão diferente do filtro — WhatsApp só olhava `responsible_id` (entry + lead), Confirmação adicionava sdr/closer, Propostas idem. Em comum, **nenhuma** olhava `pre_sale_responsible_id` nem `sale_responsible_id`.
- **Frontend**: helper único `matchesResponsibleFilter` em `src/lib/kanban-filters.ts`. Os 3 pipes agora usam o mesmo código — zero duplicação.

## Bug original

Lead `ad31600e-2ca7-4e5a-b5b3-debf50bd338d` (Alessandra Pinheiro, org Basic4u). No `pipe_whatsapp`, a Bruna (`tm.id = d2883fad-8e72-4a23-be2b-510317d2f1c4`, role `member`) era responsável **apenas** via `pipeline_entries.metadata.pre_sale_responsible_id`. Todos os outros campos de responsável (entry + lead) estavam `null`. RLS liberava a row, mas o filtro client-side a escondia quando a Bruna filtrava por si mesma.

Investigação prod (read-only, autorizada pelo CTO nesta sessão) confirmou: RLS, permissões de org, e feature permissions todas OK. Causa 100% client-side.

## Arquivos tocados

- `src/lib/kanban-filters.ts` — novo. Exporta `matchesResponsibleFilter(item, filterId)` + tipos `KanbanFilterableItem` / `KanbanFilterableLead`. Função pura, sem React/hooks. Retorna `true` se `filterId === "all"` (ou `null`/`""` — tratados como "sem filtro"), ou se bate em qualquer um dos 9 campos não-nulos.
- `src/pages/PipeWhatsapp.tsx` — `filterItems` agora chama o helper. Substituiu match local que só lia `item.responsible_id` / `item.lead?.responsible_id`.
- `src/pages/PipeConfirmacao.tsx` — `filterConfirmacao` agora chama o helper. Substituiu match local que lia sdr/closer/responsible (entry + lead) mas ignorava pre_sale/sale.
- `src/pages/PipePropostas.tsx` — `filterProposta` agora chama o helper. Substituiu match local que lia closer/responsible (entry) + sdr/closer/responsible (lead).
- `tests/unit/kanban-filters.test.ts` — novo. 17 casos: `all`, null/undefined filterId, no-match, cada um dos 9 campos isolado, caso real Alessandra (entry com só `pre_sale_responsible_id`, lead todo null, filterId = Bruna → `true`), shape defensivo (lead nulo, item nulo).

## Componentes não tocados

- `src/components/custom-pipelines/CustomPipelineKanban.tsx` — verificado, não tem filtro de responsável. Não inventei feature.
- UI do dropdown (`KanbanFilterPanel`, `useResponsibleMembers`).
- Auto-scope `membroDefaultApplied` (Confirmação e Propostas) — segue como está.
- `permissions.ts`, RLS, edge functions, migrations.

## Decisões

- **Helper puro, não hook.** Função `matchesResponsibleFilter(item, filterId): boolean`. Não tem deps de React, é trivial de testar e de mover entre páginas / componentes futuros (custom pipelines, list view).
- **`closer_id` só lido do lead, não do entry.** O `flattenMetadata` em `usePipelineEntries.ts` (linhas 65–94) **não** popula `closer_id` do metadata — só usa `entry.lead?.closer_id` como fallback. Manter `lead.closer_id` no helper preserva 100% do comportamento anterior.
- **Filtro continua display-only.** RLS é a fonte da verdade pra autorização. Helper relaxa pra **mostrar mais**, não pra **autorizar mais**. Nenhum risco de vazamento cross-tenant — entry já chegou pelo SELECT autorizado pelo RLS.
- **String vazia / `null` / `undefined` tratados como "all".** Robustez defensiva pra evitar regressão silenciosa (esquecer `?? "all"`).

## Áreas frágeis

- 🟠 **Permissões / multi-tenancy**: filtro é display-only. RLS continua sendo a fonte da verdade. Não dependa do filtro pra autorização.
- Conhecido (não corrigido aqui — registrado como backlog): `leads.pre_sale_responsible_id` e `pipeline_entries.metadata.pre_sale_responsible_id` podem divergir. Hoje só o entry é populado em muitos casos. Possível sincronização cross-tabela (trigger) fica como follow-up.

## QA

- `npx vitest run tests/unit/kanban-filters.test.ts` — **17/17 verdes**.
- `npx tsc --noEmit` — sem erros.
- `npx eslint src/lib/kanban-filters.ts src/pages/PipeWhatsapp.tsx src/pages/PipeConfirmacao.tsx src/pages/PipePropostas.tsx tests/unit/kanban-filters.test.ts` — **0 errors**. Warnings pré-existentes (any-types em código legado dos 3 pipes) intactas. Arquivos novos (`kanban-filters.ts` + teste) sem warnings.
- Suite completa de unit roda; falhas pré-existentes (Copilot `phone_ai_preferences`, integration tests sem Supabase local, `shared-action-handler` Evolution fetch) não relacionadas a este escopo.

## Follow-ups

- Sincronização `leads.pre_sale_responsible_id` ↔ `pipeline_entries.metadata.pre_sale_responsible_id`. Hoje muitas entries só populam o metadata e o lead row fica `null`. Avaliar trigger DB ou normalização. Não bloqueia este fix — backlog.
- Considerar aplicar o mesmo helper na list view (`PipeTableView`) e em qualquer custom pipeline que ganhe filtro de responsável no futuro.
