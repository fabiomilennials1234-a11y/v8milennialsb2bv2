# Module — leads

**Status:** 🟢 Active (slice 4 + cleanup longtail slice 16 — 2026-05-28)
**BC:** leads
**Entidade primária:** Lead
**Owner:** vendas

## Escopo

Lead = pessoa/empresa no sistema. Campos: nome, empresa, telefone, email, origem, qualification_score(0-100 auto), qualification_tier/pre_qualification_tier, tags, responsáveis (SDR/Closer/Responsible). `leads.rating` continua na tabela e na API pública, mas SAIU da interface em 2026-09-03 (o "calor").

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
- Recorte por funil: `useLeadsPorFunil({ pipelineId, search })` — "os leads DESTE funil", busca **server-side** (reusa `applyLeadListFilters`, a mesma semântica da lista), paginado em `LEADS_POR_FUNIL_PAGE_SIZE` (25) com `temMais`. Raiz da consulta em `leads` com `pipeline_entries!inner` — não o contrário: dedup de graça (um lead pode ter N entries no mesmo funil desde `20270730000050`), RLS na ordem certa, e um único filtro cobre funil de sistema e custom. Consumido pela Agenda (`LeadPorFunilPicker`).
  ⚠️ **Não use `useLeads()` sem argumento como fonte de um seletor** — devolve a primeira página de 50 e filtra em memória. Foi exatamente esse o bug do seletor de lead da Agenda.
- Origens: `useLeadOrigins` — fonte única (dinâmica) de lista/label/cor via tabela registry `lead_origins`. Retorna `{ origins, labelOf, colorOf, isLoading }`. Built-ins globais (org_id NULL) + custom da org (Slice B). Fallback local `BUILTIN_LEAD_ORIGINS` (13). Substitui a antiga `src/lib/lead/lead-origins.ts` (deletada) e os maps hardcoded de label do LeadModal/LeadCreateForm/LeadSource.
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
- **Slice 16 longtail**: `useTags` (CRUD tags org-scoped), `useImportBatches` (rastreio import jobs), `useEnrichment` (Apollo/dadosify enrichment), `useBulkActions` + `useBulkSelection` (bulk ops em leads table/kanban)

### Components
- Lead detail modal: `LeadDetailDialog` (+ V1/V2 explícitos), `LeadDetailSheet` (alias), `LeadPanelProvider`, `useLeadSheet`, `LeadDetailMobileTabs`
- Card/modal/score: `LeadCard`, `LeadModal`, `LeadScoreBadge`, `TimelineItem`
- Form internals consumidos cross-module: `LeadDetailContent`, `LeadCustomFields`, `AddCustomFieldPopover`, `LeadTabHistory`
- Modais standalone: `CustomFieldsManager`, `ExportLeadsContent`, `ImportLeadsFunnelContent`, `ImportLeadsContent`/`ImportLeadsModal`
  - **Dois importadores, e a diferença é o destino.** `ImportLeadsFunnelContent` põe o lead num funil (pede etapa, escreve `pipeline_entries`); `ImportLeadsModal` — o botão Importar da tela de Leads — cria **só a pessoa**, sem negócio, via `importLeadsOnly` → edge `import-leads` com `destination: "leads"`. Mesmo parser, mesmo modelo de planilha, mesmo mapeamento de coluna. Colunas de funil (Etapa, Valor, Produto) são lidas e ignoradas no caminho sem funil.
- Bulk (slice 16): `BulkActionBar` (`components/bulk-actions/`)

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
- Import: `FilePreviewResult`, `ColumnMappingOption`, `EdgeFunctionReport`, `FunnelDestination`, `ImportLeadsToCustomPipelineOptions`, `ImportLeadsToFunnelOptions`, `ImportLeadsOnlyOptions`, `ImportFunnelResult`
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

## Dedup feita (slice 16 longtail)

- `useTags`, `useImportBatches`, `useEnrichment`, `useBulkActions`, `useBulkSelection`, `useBatchedLeadMetrics` movidos de `src/hooks/` para `src/modules/leads/hooks/`.
- `BulkActionBar` movido de `src/components/bulk-actions/` para `src/modules/leads/components/bulk-actions/`.

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

## Origens de lead — registry `lead_origins` (Slice A, 2026-07-13)

Fonte única de **lista/label/cor** das origens de lead. Antes havia 4 fontes
dessincronizadas (canônica `analytics/useMktOriginConfig`, stale `src/lib/lead/lead-origins`
com só 7, + maps locais). Slice A criou a tabela registry `lead_origins` e o hook
`useLeadOrigins` como fonte dinâmica.

- **Migration**: `supabase/migrations/20270314000000_lead_origins_registry.sql` — tabela
  `lead_origins` (org_id NULL = built-in global; preenchido = custom da org), RLS
  (built-ins legíveis por qualquer authenticated; custom via `get_my_organization_ids()`
  OR `is_master_user()`; service_role FOR ALL), seed dos 13 built-ins espelhando
  `useMktOriginConfig`. Aplicada em **dev** (`bcfadphgsibjzivtbjvc`) e **prod**
  (`jsjsmuncfkbsbzqzqhfq`, 2026-07-13 — via MCP execute_sql, DDL idempotente; verificado:
  13 built-ins, RLS on, authenticated=SELECT, anon=deny, service_role=ALL, 0 advisor hits).
  Versão da migration = `20270314000000` (a `20270313000000` colidia com
  `drop_dead_whatsapp_messages_indexes` já em prod).
- **Hook**: `useLeadOrigins()` (barrel `@/modules/leads`). Consumido por `LeadCreateForm`,
  `LeadModal`, `LeadSource` e o editor de origem do drawer V2 (`InfoBlockTracking`).
- **Editar origem (drawer V2)**: `info-field-config.ts` origin `type:"origin"` (não mais
  readOnly) + `InfoBlockTracking` renderiza Select editável (persiste via `useUpdateLead`,
  invalida `["lead-detail", id]` + `["leads"]`). Badge de cor preservado (usa
  `ORIGIN_COLORS` de `LeadCard`, sem regressão visual).

### Pendente Slice B (não fazer sem pedido)
- Enum `lead_origin` → text + CRUD de origens custom por org (policies INSERT/UPDATE/DELETE
  + UI de settings). Slice A **não** mexeu no enum nem em webhooks.
- Migração dinâmica dos **color maps** que ainda são estáticos (built-ins idênticos ao seed,
  mantidos para não regredir dashboards): `LeadCard.ORIGIN_COLORS` (bg/text pairs),
  kanban (`KanbanCard`/`KanbanFilterPanel`/`CreateOpportunityModal`/`PipeTableView`),
  analytics charts (`ResponseByOrigin`/`AttributionTable`/`LeadQualityByOrigin`/`RevenueAttribution`/`OriginDonut`),
  marketing (`MktConfigModal`/`MktOriginCard`/`MktOriginRanking`), e os consts
  `ALL_ORIGINS/ORIGIN_LABELS/ORIGIN_COLORS` de `analytics/useMktOriginConfig`.

## Slice de migração

**Slice 4** — branch `feat/modularizacao/03-leads` (estimativa 6h impl + 2h dedup = 8h).

## Refs

- ADR: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Lead Detail Modal: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Vendas/Lead Detail Modal.md`
- Auditoria duplicatas: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/modularizacao/auditoria-duplicatas.md`
- SPEC modularização: `.specs/features/modularizacao/SPEC.md`
- Slices roadmap: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/slices.md`
