# Module — leads

**Status:** 🟡 Skeleton (slice 4 popula)
**BC:** leads
**Entidade primária:** Lead
**Owner:** vendas

## Escopo

Lead = pessoa/empresa no sistema. Campos: nome, empresa, telefone, email, origem, rating(1-5 manual), qualification_score(0-100 auto), tags, responsáveis (SDR/Closer/Responsible).

Inclui:
- CRUD de lead
- Lead detail modal (redesigned em 2026-05-17, ver ADR)
- Lead timeline / histórico de stage / field changelog
- Tags + scoring + qualification
- Import (CSV, bulk)
- Trash / duplicates / dedup
- Custom fields por org
- Lead form (landing public)

## Não-escopo

- Pipeline placement do lead → `pipelines` (mas lead pode estar em múltiplos pipes)
- Conversa WhatsApp/Meta → `communication`
- Workflows acionados em mudança de stage → `workflows`
- Landing page pública de captura → `marketing`

## API pública (`index.ts`) — TBD slice 4

Provável superfície:
- Hooks: `useLeads`, `useLead`, `useLeadTimeline`, `useLeadCustomFields`, `useImportLeads`, `useExportLeads`, `useDuplicateLeads`, `useTrashLeads`
- Components: `<LeadCard>`, `<LeadModal>`, `<LeadTimeline>`
- Types: `Lead`, `LeadStatus`, `LeadHistory`
- Eventos (post slice 19): `lead.created`, `lead.updated`, `lead.assigned`, `lead.tag_added`, `lead.tag_removed`, `lead.deleted`

## Áreas frágeis

- 4 hooks sobre histórico/timeline (`useLeadHistory` + `useLeadTimeline` + `useFieldChangelog` + `useFieldChanges`) — consolidar em slice 4
- 3 pastas duplicadas (`components/lead/`, `lead-detail/`, `leads/`) — consolidar
- Lead pode estar em múltiplos pipes simultaneamente — invariante crítico
- Lead em trash NÃO some, soft-delete via `deleted_at`

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/lead/` (lead-card, pipe, tabs, modal)
- `src/components/lead-detail/` (modal-redesign)
- `src/components/leads/` (LeadModal.tsx 884 linhas, TimelineItem, FieldChangelogTimeline)
- `src/hooks/useLeads.ts` (975 linhas, monolítico)
- `src/hooks/useLead*.ts` (useLeadHistory, useLeadTimeline, useLeadCustomFields, useLeadAllPipelines, useLeadProducts, useLeadScore, useLeadWriteInstance)
- `src/hooks/useFieldChangelog.ts`, `useFieldChanges.ts`
- `src/hooks/useDuplicateLeads.ts`, `useExportLeads.ts`, `useImportLeads.ts`, `useTrashLeads.ts`, `useNewLeads.ts`
- `src/hooks/useBatchedLeadMetrics.ts`, `useLogLeadAction.ts`
- `src/pages/Leads.tsx`, `Duplicates.tsx`, `Trash.tsx`

Backend:
- `supabase/functions/lead-webhook/`
- `supabase/functions/import-leads/`
- `supabase/functions/calculate-lead-score/`
- `supabase/functions/get-lead-timeline/`
- `supabase/functions/webhook-new-lead/` (auditar — duplica `lead-webhook`?)

## Slice de migração

**Slice 4** — `feat/modularizacao/03-leads` (6h + 2h dedup = 8h)

## Dedup pendente

- `useLeadHistory` + `useLeadTimeline` + `useFieldChangelog` + `useFieldChanges` → consolidar em `useLeadTimeline`
- `FIELD_LABELS` (em `useFieldChangelog`) → mover para `src/shared/format/lead-field-labels.ts`
- `webhook-new-lead` vs `lead-webhook` → auditar e decidir

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Lead Detail Modal: `Obsidian/.../06 — Features/Vendas/Lead Detail Modal.md`
- Auditoria duplicatas: `Obsidian/.../06 — Features/modularizacao/auditoria-duplicatas.md`
