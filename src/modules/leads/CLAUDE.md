# Module — leads

**Status:** 🟢 Populado (slice 4 — 2026-05-26)
**BC:** leads
**Entidade primária:** Lead
**Owner:** vendas

## Escopo

Lead = pessoa/empresa no sistema. Campos: nome, empresa, telefone, email, origem, rating(1-5 manual), qualification_score(0-100 auto), tags, responsáveis (SDR/Closer/Responsible).

Inclui:
- CRUD de lead
- Lead detail modal (redesigned em 2026-05-17, ver ADR)
- Lead timeline / histórico de stage / field changelog (consolidados em `useLeadTimeline`)
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

## API pública (`index.ts`)

Ver `./index.ts` para a superfície completa. Estável.

### Hooks
- CRUD: `useLeads`, `useLeadsCount`, `useCreateLead`, `useUpdateLead`, `useDeleteLead`, `useDeleteAllLeadsInPipe`, `useDeleteAllLeads`
- AI: `useLeadAiStatus`, `useToggleLeadAI`, `usePhoneAiStatus`, `useToggleConversationAI`
- Cross-pipe placement: `useLeadAllPipelines`, `useAddLeadToStandardPipe`, `useMoveLeadInStandardPipe`, `useRemoveLeadFromStandardPipe`
- Custom fields: `useLeadCustomFields`, `useLeadCustomFieldValues`, `useCreateCustomField`, `useDeleteCustomField`, `useSaveCustomFieldValue`
- Products: `useLeadProducts`, `useAddLeadProduct`, `useUpdateLeadProduct`, `useRemoveLeadProduct`
- Score: `useLeadScores`, `useLeadScore`, `useCalculateLeadScore`, `useCalculateBatchScores`, `useLeadScoresMap`
- WhatsApp write-instance: `useLeadWriteInstance`
- Timeline (consolidado): `useLeadTimeline`, `useLeadTimelineCompact`, `useLeadHistory`, `useCreateLeadHistory`, `useFieldChangelog`, `FIELD_LABELS`, `getFieldLabel`, `formatFieldValue`
- Métricas batch: `useBatchedLeadMetrics`
- Action log: `useLogLeadAction`, `logLeadActionDirect`
- Import/export/duplicates/trash/novo: `useImportLeads`, `useExportLeads`, `useDuplicateLeads`, `useMergeLeads`, `useTrashLeads`, `useRestoreLead`, `useRestoreLeadsBulk`, `usePurgeLead`, `useNewLeads`
- Lead-form helpers (subpasta `hooks/lead/`): `useLeadCampaignsAttach`, `useLeadCreateHandler`, `useLeadForm`, `useLeadPipeHandlers`, `useLeadTagsAttached`, `useAddLeadTag`, `useRemoveLeadTag`

### Components
- Lead detail modal: `LeadDetailDialog` (+ V1/V2 explícitos), `LeadDetailSheet` (alias), `LeadPanelProvider`, `useLeadSheet`, `LeadDetailMobileTabs`
- Card/modal/score: `LeadCard`, `LeadModal`, `LeadScoreBadge`, `TimelineItem`
- Form internals consumidos cross-module: `LeadDetailContent`, `LeadCustomFields`, `AddCustomFieldPopover`, `LeadTabHistory`
- Modais standalone: `CustomFieldsManager`, `ExportLeadsContent`, `ImportLeadsFunnelContent`

### Pages (deep-import only)
- `@/modules/leads/pages/Leads`
- `@/modules/leads/pages/Duplicates`
- `@/modules/leads/pages/Trash`

Pages NÃO são exportadas via `index.ts` — `App.tsx` faz deep-import para preservar code-splitting via `React.lazy()`.

### Types
- Lead/CRUD: `Lead`, `LeadInsert`, `LeadUpdate`, `LeadsFilterParams`, `PipeTypeForDelete`, `LeadCardData`, `LeadCardVariant`, `LeadCardProps`
- Pipelines: `StandardPipelineStatus`, `CustomPipelineStatus`, `PipelineStatus`
- Custom fields: `CustomField`, `CustomFieldValue`
- Products: `LeadProduct`
- Score: `LeadScore`
- Write-instance: `LeadWriteInstanceState`
- Timeline: `TimelineSource`, `TimelinePeriod`, `TimelineFilters`, `TimelineEvent`, `TimelineMetrics`, `TimelinePage`, `LeadHistory`, `LeadHistoryInsert`, `FieldChange`
- Métricas: `LeadMetrics`
- Action log: `LeadActionType`, `LeadActionTier`
- Import: `FilePreviewResult`, `ColumnMappingOption`, `EdgeFunctionReport`, `FunnelDestination`, `ImportLeadsToCustomPipelineOptions`, `ImportLeadsToFunnelOptions`, `ImportFunnelResult`
- Export: `ExportStageFilter`, `ExportLeadsOptions`, `UseExportLeadsResult`
- Duplicates/trash/novo: `DuplicateGroup`, `TrashLead`, `NewLeadsBucket`, `NewLeadsSource`, `NewLeadsData`
- Tags attached: `AttachedLeadTag`

Eventos (post slice 19): `lead.created`, `lead.updated`, `lead.assigned`, `lead.tag_added`, `lead.tag_removed`, `lead.deleted`.

## Áreas frágeis

- **`useLeads.ts` é monolítico (975 linhas)** — `LEADS_PAGE_SIZE`, paginação infinita, filtros multifacetados, realtime via `useRealtimeSubscription`. **NÃO refatorar sem slice dedicada.** Refactor incremental no slice 16.
- **Lead pode estar em múltiplos pipes simultaneamente** — invariante crítico. Hook `useLeadAllPipelines` consolida via RPC.
- **Lead em trash NÃO some, soft-delete via `deleted_at`** — fluxos de trash/restore/purge usam `useTrashLeads`.
- **Timeline = consolidação de 4 fontes** (`lead_history` + `field_changes` RPC + pipeline transitions + sistema). `useLeadTimeline` é a única superfície pública. Internals (`useLeadHistory`, `useFieldChangelog`) ainda exportados por compat — call sites legados, remover post-slice 17.
- **Realtime**: `useLeads` assina via `useRealtimeSubscription` com debounce 2s e filtro `organization_id`. **Não mexer na assinatura sem testar concorrência multi-tab.**
- **Multi-tenancy**: toda query filtra `organization_id` via hook `useOrganization()`. RLS no Postgres é o gate final.
- **Lead detail modal V1 vs V2**: feature-flag `new_lead_modal_v2` em `organizations.flags`. V2 é o redesign 2026-05-17 (ADR). Mudanças simultâneas em ambos exigem teste manual nos dois variants.

## Origem (pré-slice 4)

Frontend (todas movidas, dirs antigas removidas):
- ~~`src/components/lead/`~~ → `src/modules/leads/components/lead/`
- ~~`src/components/lead-detail/`~~ → `src/modules/leads/components/lead-detail/`
- ~~`src/components/leads/`~~ → `src/modules/leads/components/leads/`
- ~~`src/hooks/useLeads.ts` + `useLead*.ts`~~ → `src/modules/leads/hooks/`
- ~~`src/hooks/useFieldChange*.ts`~~ → consolidado em `useLeadTimeline.ts`
- ~~`src/hooks/use(Duplicate|Export|Import|Trash|New)Leads.ts`~~ → `src/modules/leads/hooks/`
- ~~`src/hooks/useBatchedLeadMetrics.ts`, `useLogLeadAction.ts`~~ → `src/modules/leads/hooks/`
- ~~`src/hooks/lead/`~~ → `src/modules/leads/hooks/lead/`
- ~~`src/pages/Leads.tsx`, `Duplicates.tsx`, `Trash.tsx`~~ → `src/modules/leads/pages/`

Backend (NÃO movidas nesta slice — vai pra slice 15):
- `supabase/functions/lead-webhook/` (webhook genérico — Meta Ads, Google, landing, n8n)
- `supabase/functions/webhook-new-lead/` (variante mais nova com `validateApiKey`)
- `supabase/functions/import-leads/`
- `supabase/functions/calculate-lead-score/`
- `supabase/functions/get-lead-timeline/`

## Dedup feita (slice 4)

- **Timeline (4→1)**: `useLeadHistory` + `useLeadTimeline` + `useFieldChangelog` + `useFieldChanges` consolidados em `src/modules/leads/hooks/useLeadTimeline.ts`. Exports legados mantidos por compat (`useLeadHistory`, `useFieldChangelog`, `useCreateLeadHistory`).
- **`FIELD_LABELS`**: extraído de `useFieldChangelog` para `src/shared/format/lead-field-labels.ts` (utilitário puro cross-module, sem dependência de React/Supabase). Re-exportado da API pública do módulo por compat.

## Auditoria pendente — webhook-new-lead vs lead-webhook

Comparação rápida (slice 4 — não-resolvida, vai pra slice 15):

| Aspecto | `lead-webhook` (914 linhas) | `webhook-new-lead` (464 linhas) |
|---|---|---|
| Idade | Mais antigo (canônico, documentado na CLAUDE.md raiz) | Variante posterior |
| Auth | Rate limit + timing-safe compare via `_shared/auth.ts` | `validateApiKey` (90-day grace, expira `2026-07-09`) |
| Helpers compartilhados | `getOrCreateLead`, `enqueueWebhookDeliveries`, `getCampaignLeadAssignment`, `pipeline-adapter` | `validateLeadInput`, `sanitizeString`, `validateReferencedId`, `pipeline-adapter`, `workflow-trigger` |
| `place_in_pipe` | `whatsapp` | `confirmacao` | `propostas` | Similar |
| `place_in_campaign` | Sim — distribuição round-robin via `campaign-distribution` | (verificar) |
| `update_existing_if_match` | Sim — match por phone/email | Sim — match por phone/email/name + day boundary |
| Triggers downstream | `enqueueWebhookDeliveries` (workflow + n8n) | `fireTrigger` direto |
| Documentação | `README.md` no diretório, mencionado em `CLAUDE.md` raiz | Sem README |

**Recomendação para slice 15**: `lead-webhook` é o canônico (é o documentado, integrado a n8n e usado pelos 20+ workflows Trello→V8). `webhook-new-lead` parece um experimento/fork com auth mais nova mas menos completo. Caminhos:
1. **Consolidar features** (`validateApiKey` + helpers de validação) em `lead-webhook` e deprecar `webhook-new-lead` (rota `/webhook-new-lead` continua respondendo com 301 ou 200 por 90 dias).
2. **Migrar pra `webhook-new-lead`** (mais limpo arquiteturalmente) — porém impacta 20+ workflows n8n em prod, exige coordenação com clientes.

Decisão fica para slice 15 (consolidação backend).

## Slice de migração

**Slice 4** — branch `feat/modularizacao/03-leads` (estimativa 6h impl + 2h dedup = 8h).

## Refs

- ADR: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Lead Detail Modal: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Vendas/Lead Detail Modal.md`
- Auditoria duplicatas: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/modularizacao/auditoria-duplicatas.md`
- SPEC modularização: `.specs/features/modularizacao/SPEC.md`
- Slices roadmap: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/slices.md`
