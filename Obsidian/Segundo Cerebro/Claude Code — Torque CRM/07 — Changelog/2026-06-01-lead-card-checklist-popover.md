---
date: 2026-06-01
type: feature
branch: (a definir pelo arquiteto)
target: main
modules: [leads, engagement]
---

# Feature — popover de checklist clicável no LeadCard (kanban)

## Contexto

O badge `N/M` de checklist no `LeadCard` era um chip passivo (só tooltip). Vira
trigger de Popover que lista os checklists vinculados ao lead com itens
toggleáveis inline — confirma pontos SEM abrir o modal do lead.

Micro-feature frontend, zero backend novo. Reusa a camada de dados de checklists
do BC engagement.

## Mudanças

### Camada de dados (single source)
- **`useChecklists.ts` (engagement)** — `useLeadChecklists(leadId)` extraído da
  cópia PRIVADA que vivia em `LeadChecklistSection.tsx`. Exportado via barrel
  `@/modules/engagement` (já fazia `export *`). Mesma queryKey
  `["checklists","lead",leadId]` — `useToggleChecklistItem` invalida
  `["checklists"]` (prefixo) → modal e popover ficam em sync. Não assina realtime
  (evita subscription redundante: `useChecklistItems` já cobre `checklist_items`,
  `useBatchedLeadMetrics` cobre o badge).
- **`LeadChecklistSection.tsx`** — passou a consumir `useLeadChecklists` do barrel
  (removida a cópia local + imports `useQuery`/`supabase`/`useOrganization`).

### UI
- **`LeadCardChecklistPopover.tsx`** (NOVO, `card/`) — recebe
  `{ leadId, completed, total }`. Header sticky com N/M dos props (zero salto no
  load), mini-progress, estado "Tudo pronto" emerald em 100%. 1 checklist → itens
  diretos; 2+ → grupos colapsáveis (100% auto-colapsa). Item via shadcn `Checkbox`
  (Radix), label inteiro clicável, strike emerald. Estados: skeleton (não spinner),
  erro com "Tentar de novo" (refetch), empty defensivo. `useReducedMotion` →
  colapso/strike instantâneos. Lazy: query só dispara quando o popover abre
  (`PopoverContent` Radix não monta fechado). `onPointerDown` stopPropagation
  (dnd-kit drag-safe) + popover não dispara o `onClick` do card.
- **`LeadCardMetrics.tsx`** — nova prop `leadId?`. Badge vira
  `LeadCardChecklistPopover` SOMENTE quando `leadId` + `total>0`; senão mantém o
  chip passivo/tooltip atual.
- **`LeadCard.tsx`** — passa `leadId={lead.leadId}` (UUID do lead = `item.lead_id`,
  NÃO o pipe-entry id). Vale pra todos os consumidores do `LeadCard`.

### Badge sync (critério #3)
Resolvido sem follow-up: ao togglar, o popover patcha `["lead-card-metrics"]`
(prefix-match via `setQueriesData`) ajustando `checklistsCompleted` do lead no
mesmo frame — badge do card atualiza imediato, sem esperar o debounce de 2s do
realtime (que reconcilia o número final depois).

## Arquivos tocados
- `src/modules/engagement/hooks/useChecklists.ts` — `useLeadChecklists` adicionado
- `src/modules/leads/components/leads/card/LeadCardChecklistPopover.tsx` — NOVO
- `src/modules/leads/components/leads/card/LeadCardMetrics.tsx` — prop `leadId` + gate popover/passivo
- `src/modules/leads/components/leads/LeadCard.tsx` — passa `leadId`
- `src/modules/leads/components/leads/LeadChecklistSection.tsx` — consome hook do barrel
- `src/modules/leads/components/leads/card/__tests__/LeadCardChecklistPopover.test.tsx` — NOVO (6 testes)

## Segurança
- Multi-tenancy: `useLeadChecklists` filtra `organization_id` via `useOrganization`;
  RLS é o gate final. Read + toggle apenas (sem CRUD). Sem boundary externo/PII novo.

## QA (counts literais)
- `tsc --noEmit`: 0 errors
- eslint (touched): 0 errors (4 warnings `no-explicit-any` pré-existentes em
  `useChecklists.ts`, herdadas do mapeamento original)
- `LeadCardChecklistPopover.test.tsx`: 6/6
- `npm run test:unit` (full): 4127 passed / 58 failed / 150 skipped — as 58 falhas
  são baseline red pré-existente em main (copilot, whatsapp, auth-context,
  protected-route, cors, revision-item, hooks-batch — nenhuma toca os arquivos
  desta feature; confirmado por MEMORY + grep de referências).

## Follow-ups
- Nenhum aberto. Badge sync resolvido inline (não ficou como débito).
