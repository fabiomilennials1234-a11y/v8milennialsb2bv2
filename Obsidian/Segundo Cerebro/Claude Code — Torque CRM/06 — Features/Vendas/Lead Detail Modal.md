---
title: Lead Detail Modal
type: feature
status: shipped
created: 2026-05-17
updated: 2026-05-19
diataxis: reference
related:
  - "[[Schema]]"
  - "[[RLS Policies]]"
  - "[[Modulos]]"
  - "[[ADR-2026-05-17-lead-detail-modal-redesign]]"
---

# Lead Detail Modal

Modal centralizado de detalhes do lead. Substitui o split-pane lateral `LeadDetailSheet` legado.

## Localização

- Root: [`src/components/lead-detail/modal/LeadDetailDialog.tsx`](../../../../../src/components/lead-detail/modal/LeadDetailDialog.tsx)
- Header: `modal/header/*`
- Body: `modal/body/*`
- Activity: `modal/activity/*`
- Toolbar: `modal/LeadModalToolbar.tsx`
- Hooks: `hooks/useLeadComments.ts`, `hooks/useLeadAge.ts`
- API pública mantida: `openLead(leadId, variant, pipeData?)`, `close()` via `useLeadSheet()`

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER                                                     │
│  ┌───────────────────────────┬─────────┬──────────────────┐ │
│  │ Avatar | Identity         │ divider │  Resp+Resp       │ │
│  │  - nome                   │         │  Qual+Qual       │ │
│  │  - empresa                │         │  [Mover]         │ │
│  │  - telefone (copy)        │         │                  │ │
│  │  - idade (tooltip data)   │         │                  │ │
│  └───────────────────────────┴─────────┴──────────────────┘ │
│  TOOLBAR  [WhatsApp] [Ligar] [Email] [FUP]  | IA  | ⋮       │
├─────────────────────────────────────────────────────────────┤
│ BODY (grid 12 cols, 7 + 5)                                  │
│ ┌────────────────────────────────┬────────────────────────┐ │
│ │ INFO COLUMN                    │ ACTIVITY COLUMN        │ │
│ │ ┌─Bloco 1 — Preenchidos      │ │ Composer (Cmd+Enter)   │ │
│ │ │  (5 visíveis + show more)  │ │ ─────────────────────  │ │
│ │ ├─Bloco 2 — Faltantes        │ │ Filtros: Todos/        │ │
│ │ │  ("+ adicionar X")         │ │  Comentários/Manual/   │ │
│ │ ├─Bloco 3 — Tracking         │ │  Copilot/Auto/Sys/Pipe │ │
│ │ │  (read-only: utm/meta)     │ │ ─────────────────────  │ │
│ │ └─                          │ │ Feed intercalado       │ │
│ └────────────────────────────────┴────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

Mobile (<768px): `<Sheet side="bottom">` fullscreen 95vh, single column scrollable.

## Header

### Avatar
- 56px circular. Default: ícone `<HelpCircle>` em background neutro.
- Quando `leads.avatar_url` preenchido (via automação), renderiza imagem.
- Tooltip "Foto definida por automação (em breve)" enquanto sem URL.

### Identidade
Stack vertical: nome → empresa → telefone (formato BR + click-to-copy) → idade ("há 3 dias" + tooltip data absoluta).

### Slots de responsáveis
2 slots verticais empilhados: Pré-Venda + Venda. Mapeia em `leads.pre_sale_responsible_id` / `leads.sale_responsible_id` (consolidados em [[migration 20260930000000_dual_responsible_fields]]).

Click vazio → popover com lista de `useResponsibleMembers()` (search + scroll).
Click com membro → mostra inicial colorida (hash determinístico do nome) ou `avatar_url` se existir.

### Slots de qualificação
2 slots: Pré-Qualificação + Qualificação. Mapeia em `leads.pre_qualification_tier` / `leads.qualification_tier` (enum `qualification_tier`).

Tiers (ordem decrescente): **Diamante 💎** · **Ouro 🏆** · **Prata** · **Bronze** · **Desqualificado**.

Cores em `modal/qualification-config.tsx`.

### Stage Rails (substitui Botão Mover legado)
A partir de 2026-05-19 o `MoveStageButton` (popover "Mover") foi **removido** e o controle de stage acontece direto nas **StageRails** do `CrossPipePanel` (ver seção "Cross-Pipe Panel" abaixo).

## Cross-Pipe Panel

Painel horizontal compacto, renderizado no topo da coluna principal do modal (mobile: tab `Pipes`). Substitui o antigo `LeadCrossPipeAccordion` (acordeão vertical) — ~180 px em vez de 300-400 px no caso típico de 2 pipes ativos + 4 inativos.

### Localização
- Orquestrador: [`src/components/lead-detail/modal/pipes/CrossPipePanel.tsx`](../../../../../src/components/lead-detail/modal/pipes/CrossPipePanel.tsx)
- `StageRail.tsx` — uma row por pipe ativo, segments role=tablist com keyboard nav
- `ActionPill.tsx` — chip compacto `Reunião` / `Orçamento` com valor formatado e urgência
- `ActionPanel.tsx` — wrapper expandido + kebab "Remover de {pipe}" (substitui o antigo `RemoveFromPipeAction`)
- `InactivePipeChip.tsx` + `OtherPipesStrip.tsx` — chips dashed para pipes onde o lead **não** está
- `useCrossPipeMove.ts` — hook unificado de move stage (sistema + custom)

### Três zonas (top → bottom)
- **A. StageRails** — uma row por pipe em que o lead está. Cada segmento é clicável; arrow-left/right move foco; Enter/Space ativa. Auto-scroll do current ao montar. Estados: pending / completed / current / loading / disabled (sem permissão → opacity + tooltip).
- **B. ActionPills + Panel** — só renderiza se há entrada em `pipe_confirmacao` ou `pipe_propostas`. Click no pill abre painel; click no mesmo fecha; click no outro troca (mutex). Pill closed mostra valor formatado: meeting → `Hoje · 14h30` / `Amanhã · 14h` / `12/05 · 14h`; budget → `R$ 12,5 mil`.
  - Urgency dot só em meeting: atrasada (vermelho + pulse), hoje (âmbar), amanhã (amarelo). >2d sem dot.
  - Painel expandido renderiza `MeetingFieldBlock` ou `BudgetFieldBlock` com prop `bare={true}` (sem caixa-dentro-de-caixa). Kebab top-right absorve "Remover de {pipe}" via AlertDialog igual ao antigo.
- **C. OtherPipesStrip** — chips dashed pros pipes inativos. Click abre popover de confirmação `Adicionar`. Sucesso → chip some, rail aparece, pill auto-expand (`forceExpand`) quando aplicável. Order: sistema (qualificação, carteira, upsell) → custom alfabético. Overflow >8 vira `+N` chip.

### Lógica de move stage
`useCrossPipeMove(leadId).move(target)`:
- `kind="system"` → `UPDATE pipe_<tipo> SET status = stageKey WHERE id = pipeId` (compat views sobre `pipeline_entries`).
- `kind="custom"` → `UPDATE custom_pipe_entries SET stage_id = stageId, stage_changed_at = now() WHERE id = entryId`.
- Invalida: `["lead_all_pipelines", leadId]`, `["lead-pipes", leadId]`, `["lead-timeline", leadId]`, tabela tocada.
- Optimistic UI: segment alvo recebe `pendingStageKey` (pulse + spinner). Sucesso → flash `animate-[stage-confirm_250ms_ease-out]`.
- Logging: `lead_history` action `stage_changed`.

### Pipe terminal (propostas vendido/perdido)
Continua no rail com a stage final como `current`. Sem badge "Encerrado" — o estado já é visível pelo segment ativo.

### Permissões
- `useLeadActionGates(leadId).canMoveMeeting` controla habilitação das StageRails.
- `canAddToPipe` controla chips do strip.
- `canRemoveFromPipe` esconde o kebab no panel.

### localStorage migration
Chave: `lead-modal:expanded:{userId}:{leadId}`. Valor agora: `'meeting' | 'budget' | null`. Valores legados são migrados transparentemente no parse:
- `confirmacao` → `meeting`
- `propostas` → `budget`
- qualquer outro → `null`

### Tokens novos (em `src/index.css`)
- `@keyframes stage-confirm` — flash de sucesso no segment recém-movido (`box-shadow` ring que se expande e dissipa).
- `@keyframes panel-down` — slide-down do ActionPanel ao abrir.
Todos os usos respeitam `motion-safe:`.

### Reduce-motion
`motion-safe:animate-pulse`, `motion-safe:animate-[stage-confirm]`, `motion-safe:animate-[panel-down]` desligam quando `prefers-reduced-motion: reduce`.

### Empty states
- Lead em 0 pipes ativos + ≥1 inativo → A e B não renderizam, strip ocupa o painel.
- Lead em 0 pipes ativos + 0 inativos → empty state `Sem pipes ainda` (mantém visual do antigo `LeadCrossPipeAccordion`).

### Tests
- `__tests__/StageRail.test.tsx` — current/aria-selected, move system + custom, disabled.
- `__tests__/ActionPill.test.tsx` — formatters, toggle, aria-expanded.
- `__tests__/InactivePipeChip.test.tsx` — popover + add + disabled-reason.
- `__tests__/CrossPipePanel.test.tsx` — empty state, terminal proposta no rail, localStorage migration (`confirmacao`→`meeting`, `propostas`→`budget`, unknown → null), pill toggle.

## Body

### Bloco 1 — Preenchidos
Campos canônicos (`info-field-config.ts`) que têm valor + tags + custom fields preenchidos. Inline edit via `InfoFieldRow`. "Mostrar mais" após 5.

### Bloco 2 — Faltantes
Mesmos campos canônicos sem valor + custom fields vazios. Cada linha: CTA inline `+ adicionar X` que vira input.

Vazio: empty state verde "Lead completo".

### Bloco 3 — Tracking
Read-only: data de criação, origem (badge colorido via `ORIGIN_COLORS`), UTMs (campaign/source/medium/content/term), Meta IDs (campaign/adset/ad).

## Activity

### CommentComposer
Textarea + atalho `Cmd/Ctrl+Enter`. Mutation `useCreateLeadComment` → tabela `lead_comments`.

### ActivityFeed (intercalado)
Merge ordenado desc por `created_at` de:
- `useLeadTimeline(leadId)` — eventos de `lead_history` (filtrando `comment_*` pra evitar duplicação).
- `useLeadComments(leadId)` — comentários ativos (`deleted_at IS NULL`).

Filtros: Todos / Comentários / Manual / Copilot / Automação / Sistema / Pipeline.

### CommentItem
- Soft-delete via update `deleted_at` + `deleted_by`.
- Edição: autor próprio. Apagar: autor ou admin/master.
- Comentário apagado: placeholder mantém timeline coerente.
- Mostra avatar do autor (`team_members.avatar_url` se existir).

## Toolbar

Logo embaixo do header. Ações secundárias compactas:
- WhatsApp · Ligar · Email · Follow-up
- Toggle IA (otimista)
- Kebab menu: Registrar ligação, Email com IA, Agendar msg, Abrir conversa, SMS, Excluir.

## Schema (adicionado pela migration `20260517000000`)

```sql
ALTER TABLE leads ADD COLUMN avatar_url text;
ALTER TABLE leads ADD COLUMN pre_qualification_tier qualification_tier;
ALTER TABLE leads ADD COLUMN qualification_tier     qualification_tier;

CREATE TABLE lead_comments (
  id, organization_id, lead_id,
  author_user_id, author_team_member_id,
  body (1-4000 chars),
  created_at, updated_at,
  deleted_at, deleted_by
);
```

Backfill: `rating` (1-10) → `qualification_tier`:
- 9-10 → diamante | 7-8 → ouro | 4-6 → prata | 1-3 → bronze.

## RLS

Tabela `lead_comments`:
- SELECT/INSERT: org via `get_my_organization_ids()`.
- UPDATE: autor OU admin (`is_user_admin()`).
- INSERT extra check: `author_user_id = auth.uid()`.

## Trigger

`fn_log_lead_comment_event` — registra `comment_added` (INSERT) e `comment_deleted` (UPDATE de `deleted_at`) em `lead_history` automaticamente. Evita duplicar fluxos manuais.

## Decisões

- **Modal substitui split-pane** (não coexiste). `LeadPanelLayout` virou no-op wrapper.
- **Avatar sem upload UI** v1 — só campo aguardando automação.
- **Tiers nominais novos** (enum), não derivado de `rating`. Backfill aplicado.
- **Tabela `lead_comments` separada** de `lead_history` (soft-delete + edição não combinam com append-only).
- **Histórico + comentários intercalados**, não tabs.
- **Toolbar de ações secundárias** abaixo do header (WhatsApp/Ligar/Email/IA + kebab).
- **Mobile: Sheet bottom fullscreen** em vez de Dialog scrollable.

## Out of scope v1

- Menções `@user` + notificações
- Reactions em comentários
- Rich text/markdown
- Anexos
- Histórico de edições por comentário
