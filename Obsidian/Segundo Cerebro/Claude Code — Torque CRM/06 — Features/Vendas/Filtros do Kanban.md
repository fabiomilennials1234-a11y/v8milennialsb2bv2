---
type: feature
domain: vendas
tags: [pipelines, kanban, filtros, multi-tenancy-ui]
---

# Filtros do Kanban

## O que é

Painel de filtros (`KanbanFilterPanel`) presente nos 3 funis sistema — WhatsApp, Confirmação e Propostas. Permite ao usuário filtrar cards por Responsável, Origem, Tags, Agendados, etc. **Display-only**: relaxa ou esconde rows que o RLS já liberou. Não é mecanismo de autorização.

## Como funciona

Cada página de pipe (`src/pages/PipeWhatsapp.tsx`, `PipeConfirmacao.tsx`, `PipePropostas.tsx`) tem um closure local `filterItems` / `filterConfirmacao` / `filterProposta` que combina vários sub-filtros booleanos sobre as rows retornadas por `usePipelineEntries(slug)` (`src/hooks/usePipelineEntries.ts`).

Dados chegam ao filtro depois do `flattenMetadata` (linhas 65–94 do hook), que projeta os campos do `pipeline_entries.metadata` JSON pro nível raiz do item.

## Contrato — filtro "Responsável"

Implementação compartilhada em `src/lib/kanban-filters.ts`:

```ts
matchesResponsibleFilter(item, filterId): boolean
```

- `filterId === "all"` (ou `null`/`""`/`undefined`) → sempre `true`.
- Caso contrário, retorna `true` se `filterId` bate em **qualquer** um dos campos abaixo, comparando só valores não-nulos:

  | Origem | Campos checados |
  |---|---|
  | `item` (entry) | `responsible_id`, `sdr_id`, `pre_sale_responsible_id`, `sale_responsible_id` |
  | `item.lead`    | `responsible_id`, `sdr_id`, `closer_id`, `pre_sale_responsible_id`, `sale_responsible_id` |

- `closer_id` é lido **só** do lead — `flattenMetadata` não popula `closer_id` no entry.
- `filterId` é um `team_members.id` (dropdown serve `useResponsibleMembers()`).

## Regras de negócio

- O dropdown é **auto-escopado pra member**: em Confirmação e Propostas, na primeira renderização, se `selectedResponsibleId === "all"` e o usuário tem role `membro`, o filtro é setado pro próprio `team_member.id` automaticamente. Lógica em `membroDefaultApplied` nos dois `useEffect`s. PipeWhatsapp não faz auto-scope (filtro persiste em localStorage e default é `"all"`).
- O filtro é display-only. Auth é do RLS.
- O helper é puro (sem React, sem deps externas). Testar via vitest.

## Edge cases

- **Entry sem lead** (ghost row, RLS bloqueou o join): tratado antes do filtro pelo `filterItems(item).lead == null` — entry é descartado, não chega no helper.
- **Lead com todos os campos null + filterId real**: retorna `false`. O lead literalmente não é responsabilidade de ninguém — fica no bucket "sem responsável" se for visualizado pelo dropdown `all`.
- **Filter pra membro só presente em `pre_sale_responsible_id`**: agora bate (era o bug original — Alessandra Pinheiro / Bruna).
- **Item null** (defensivo): retorna `false` exceto se `filterId === "all"`.

## Áreas frágeis

🟠 **Multi-tenancy / permissões**: filtro é display-only. RLS continua sendo a fonte da verdade. Não dependa do filtro pra autorização. Se um membro vê uma row e não devia, é bug de RLS — não de filtro.

## Onde mexer

- Helper: `src/lib/kanban-filters.ts`
- Testes: `tests/unit/kanban-filters.test.ts`
- Pipes: `src/pages/PipeWhatsapp.tsx` (`filterItems`), `PipeConfirmacao.tsx` (`filterConfirmacao`), `PipePropostas.tsx` (`filterProposta`)
- Shape do entry: `src/hooks/usePipelineEntries.ts` — `flattenMetadata`

## Histórico

- **2026-05-18** — Filtro "Responsável" passa a usar helper único `matchesResponsibleFilter`. Cobre `pre_sale_responsible_id` e `sale_responsible_id` (entry + lead) — campos antes ignorados. Bug original: lead com `pipe_entries.metadata.pre_sale_responsible_id = Bruna` sumia quando ela filtrava por si mesma. Detalhes: [[2026-05-18-kanban-filter-responsible-helper]].
