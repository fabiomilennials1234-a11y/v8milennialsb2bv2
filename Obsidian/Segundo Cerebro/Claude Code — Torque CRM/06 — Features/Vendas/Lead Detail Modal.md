---
title: Lead Detail Modal
type: feature
status: shipped
created: 2026-05-17
updated: 2026-05-17
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

### Botão Mover
Popover com lista de stages do pipe atual (variant). Update direto em `pipe_<variant>.stage_id`. Log via `lead_history` action `stage_changed`. Inclui mini `StageProgressBar` no topo.

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
