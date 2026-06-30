---
title: Lead Detail Modal — Redesign (Trello-inspired)
type: backlog
status: shipped
created: 2026-05-17
updated: 2026-05-17
tags: [leads, lead-detail, modal, ui-redesign]
related:
  - "[[ADR-2026-05-17-lead-detail-modal-redesign]]"
owner: CTO
---

# Lead Detail Modal — Redesign

> [!success] IMPLEMENTADO — 2026-05-17 (merged `main` via #149)
> O redesign foi **implementado e mergeado em `main`** no mesmo dia da spec (PR #149, commit `7b6a73b7` — "feat(leads): redesenha modal e card do lead — Trello-style"). Entregou `LeadDetailDialog` (shadcn Dialog centralizado 1440×940, Sheet bottom em mobile), `LeadPanelLayout` virou no-op wrapper, `LeadCard` orchestrator, activity feed + comentários + info blocks. Vivo hoje em `src/modules/leads/components/lead-detail/modal/` (já com iterações V1/V2). Ver [[ADR-2026-05-17-lead-detail-modal-redesign]]. **Nota:** o texto original do card dizia "sem implementação, sem commit" — drift corrigido; o doc foi commitado JUNTO da implementação no mesmo PR.

> **Status original (histórico):** Spec aguardando autorização CTO. Sem implementação, sem commit.

## 1. Contexto

Modal atual ([LeadDetailSheet.tsx](../../../../../src/components/lead-detail/LeadDetailSheet.tsx)) é split-pane lateral: ocupa lado direito da tela via [LeadPanelLayout.tsx](../../../../../src/components/layout/LeadPanelLayout.tsx), página comprime pra 45%. Informações densas, tipografia pequena (10–11px), 6 seções colapsáveis na coluna esquerda + abas Atividade/Notas à direita.

CTO pediu remodelagem inspirada no modal centralizado do Trello: header proeminente, corpo two-column equilibrado, ações principais empilhadas vertical à direita do header, info distribuída em 3 blocos verticais à esquerda, histórico+comentários à direita.

## A — Inventário

### A.1 Componentes existentes (a substituir / reaproveitar)

| Path | Papel atual | Destino |
|------|-------------|---------|
| [LeadDetailSheet.tsx](../../../../../src/components/lead-detail/LeadDetailSheet.tsx) | Container do split-pane + tabs Atividade/Notas | **Substituir** por Dialog centralizado |
| [LeadDetailHeader.tsx](../../../../../src/components/lead-detail/LeadDetailHeader.tsx) | 4 rows: avatar+name+close, pills, progress bar, ações | **Substituir** por header com identidade ⟂ ações verticais |
| [LeadDetailProperties.tsx](../../../../../src/components/lead-detail/LeadDetailProperties.tsx) | Sidebar 220px com 6 PropertyGroup colapsáveis | **Refatorar** em 3 blocos (Form / Faltantes / Tracking) |
| [LeadDetailTimeline.tsx](../../../../../src/components/lead-detail/LeadDetailTimeline.tsx) | Métricas + filtros + eventos + changelog | **Reaproveitar** com adaptações (intercalar comentários) |
| [LeadDetailNotes.tsx](../../../../../src/components/lead-detail/LeadDetailNotes.tsx) | Tab separada de notas via `lead_history.action='note_added'` | **Substituir/fundir** com timeline (ver D.6) |
| [LeadDetailFocus.tsx](../../../../../src/components/lead-detail/LeadDetailFocus.tsx) | Focus mode | Manter, opcional |
| [LeadDetailFunnelContext.tsx](../../../../../src/components/lead-detail/LeadDetailFunnelContext.tsx) | Contexto do funil corrente | Manter (mover pro corpo) |
| [PropertyGroup.tsx](../../../../../src/components/lead-detail/PropertyGroup.tsx) | Wrapper collapsível | Manter |
| [InlineField.tsx](../../../../../src/components/lead-detail/InlineField.tsx) | Edição inline | Manter |
| [StageProgressBar.tsx](../../../../../src/components/lead-detail/StageProgressBar.tsx) | Progress de stages | Mover para botão **Mover** (popover) |
| [hooks/useLeadDetail.ts](../../../../../src/components/lead-detail/hooks/useLeadDetail.ts) | Query lead + pipes | Reaproveitar 100% |
| [hooks/useLeadSheet.tsx](../../../../../src/components/lead-detail/hooks/useLeadSheet.tsx) | Context global do panel | Reaproveitar (mantém API `openLead`, `close`) |
| [hooks/useInlineEdit.ts](../../../../../src/components/lead-detail/hooks/useInlineEdit.ts) | Hook edit inline | Manter |
| [LeadPanelLayout.tsx](../../../../../src/components/layout/LeadPanelLayout.tsx) | Split layout 55%/45% | **Aposentar** — modal centralizado substitui |

### A.2 Hooks de domínio consumidos

- [useLeads.ts](../../../../../src/hooks/useLeads.ts) — `useUpdateLead`, `useToggleLeadAI`, `useDeleteLead`
- [useTeamMembers.ts](../../../../../src/hooks/useTeamMembers.ts) — `useResponsibleMembers`
- [useTags.ts](../../../../../src/hooks/useTags.ts) — `useTags`
- [useLeadCustomFields.ts](../../../../../src/hooks/useLeadCustomFields.ts) — `useLeadCustomFields`, `useLeadCustomFieldValues`, `useSaveCustomFieldValue`
- [useLeadTimeline.ts](../../../../../src/hooks/useLeadTimeline.ts) — timeline unificada (manual/agent/automation/system + pipeline)
- [useLogLeadAction.ts](../../../../../src/hooks/useLogLeadAction.ts) — log de ações em `lead_history`
- [useTrackView.ts](../../../../../src/hooks/useTrackView.ts) — view tracking
- [usePipelineStages.ts](../../../../../src/hooks/usePipelineStages.ts) — stages do kanban

### A.3 Schema `leads` relevante ([types.ts:6920](../../../../../src/integrations/supabase/types.ts#L6920))

Colunas existentes: `id, organization_id, name, company, email, phone, normalized_phone, faturamento, segment, urgency, origin, notes, rating, qualification_score, ai_disabled, created_at, updated_at, deleted_at, compromisso_date, responsible_id, sdr_id, closer_id, pre_sale_responsible_id, sale_responsible_id, utm_campaign, utm_source, utm_medium, utm_content, utm_term, meta_ad_id, meta_adset_id, meta_campaign_id, import_batch_id, is_shadow, metrics_period_at, company_entity_id, contact_id`.

**Faltam pra spec:**
- `avatar_url text null` — sem campo hoje. Migração nova.
- Coluna pra "pré-qualificação" (Diamante/Ouro/Prata/Bronze/Desqualificado) — escolha pendente (ver D.3).

### A.4 Tabelas correlatas

- `lead_history` — timeline atual (action, description, source, metadata, created_by). Recebe `note_added` hoje. Append-only de fato.
- `lead_tags` ↔ `tags` — etiquetas.
- `field_changes` — changelog de campos específicos (alimentado por `fn_track_lead_field_changes`, trigger em `leads`, tracked_fields: `name, company, email, phone, origin, rating, qualification_score, responsible_id, sdr_id, closer_id, ai_disabled, notes, segment`).
- `pipe_whatsapp / pipe_confirmacao / pipe_propostas / custom_pipe_entries` — onde o lead está nos funis.
- `pipeline_stages` — stages dinâmicas.
- `team_members` — vendedores (tem `avatar_url` desde 2026-09).

**Não existe `lead_comments`.** Comentários hoje vivem em `lead_history.action='note_added'`. Decisão pendente (D.7).

### A.5 RLS relevante

- `leads_select_by_responsibility_and_permissions` + `leads_update_by_responsibility_and_permissions` ([migration 20260930000000](../../../../../supabase/migrations/20260930000000_dual_responsible_fields.sql)) — dual fields + legacy + `has_feature_permission('leads.view_all')`.
- `lead_history` — RLS via org_id (existente).
- Para `lead_comments` (se criar) — padrão `auth.org_id()` + WITH CHECK (ver template em [migrations/CLAUDE.md](../../../../../supabase/migrations/CLAUDE.md)).

### A.6 Onde modal é montado (call sites)

```
src\pages\PipeWhatsapp.tsx:132,581,604,723
src\pages\PipeConfirmacao.tsx:246,632,830
src\pages\PipePropostas.tsx:48,1494
src\pages\Leads.tsx:188,568
src\pages\CustomPipeline.tsx:64,186
src\pages\PipeFollowUps.tsx
src\pages\Revisao.tsx:30,143,381-385
src\components\campanhas\CampanhaKanban.tsx:527,743
src\components\upsell\UpsellBaseKanban.tsx:41,120
src\components\upsell\UpsellCampanhasKanban.tsx:37,222
src\components\upsell\UpsellGestaoKanban.tsx:40,117
src\components\analytics\tabs\UtmsTab.tsx
```

**API pública mantida**: `openLead(leadId, variant, pipeData?)` + `close()` continua igual. Todos os call sites permanecem inalterados. Só a camada de renderização troca (LeadPanelLayout → Dialog).

### A.7 Edge functions / mutations envolvidas

- `useUpdateLead` (mutation → `supabase.from('leads').update`) — para campos editáveis.
- `useToggleLeadAI` — toggle IA (`ai_disabled`).
- `useDeleteLead` — soft delete.
- `move-pipe-record` (edge function, gated por permissão) — usado para mover lead pelas stages (ver ADR pendente em `08 — Backlog/backlog/move-pipe-record-server-side.md`).
- `supabase.from('lead_history').insert` — adicionar notas (hoje em LeadDetailNotes).

### A.8 Vault — notas impactadas

| Path | Ação |
|------|------|
| `02 — Arquitetura/Modulos.md` | Atualizar bloco "lead-detail" |
| `03 — Reference/Schema.md` | Adicionar `leads.avatar_url`, `lead_comments` (se criar) |
| `03 — Reference/RLS Policies.md` | Política de `lead_comments` |
| `04 — Decisões/` | Criar ADR-2026-05-17-lead-detail-modal-redesign.md |
| `06 — Features/Vendas/Lead Detail Modal.md` | **CRIAR** — feature spec do modal redesenhado |
| `07 — Changelog/2026-05-17-lead-detail-redesign.md` | Append no release |
| `08 — Backlog/em-progresso/lead-detail-modal-redesign.md` | Este documento |

**Lacuna atual**: vault não documenta o modal lateral existente. Esta feature é oportunidade pra criar a feature note em `06 — Features/Vendas/`.

---

## B — Arquitetura proposta

### B.1 Topo do componente

```
LeadDetailDialog (shadcn Dialog, max-w-[1100px], rounded-2xl, dark-first)
├── DialogContent (overlay blur + scroll lock)
│   ├── LeadDetailModalHeader
│   │   ├── LeadIdentityBlock     (avatar + name/company/phone/age)
│   │   ├── VerticalDivider
│   │   └── LeadActionsBlock      (responsibles + qualifications + move)
│   └── LeadDetailModalBody (grid 12 cols)
│       ├── LeadInfoColumn        (col-span-7 — 3 blocos verticais)
│       │   ├── InfoBlockFilled
│       │   ├── InfoBlockMissing
│       │   └── InfoBlockTracking
│       └── LeadActivityColumn    (col-span-5 — timeline + comentários)
│           ├── CommentComposer
│           └── ActivityFeed (intercala lead_history + comentários ordenados por created_at)
```

### B.2 Pastas

```
src/components/lead-detail/
├── modal/                         ← NOVO submódulo
│   ├── LeadDetailDialog.tsx       ← root (substitui LeadDetailSheet)
│   ├── header/
│   │   ├── LeadModalHeader.tsx
│   │   ├── LeadIdentityBlock.tsx
│   │   ├── LeadActionsBlock.tsx
│   │   ├── ResponsibleSlot.tsx    ← bolinha com "+" → seletor → inicial
│   │   ├── QualificationSlot.tsx  ← bolinha com "+" → seletor → símbolo
│   │   ├── MoveStageButton.tsx    ← popover c/ kanban stages
│   │   └── LeadAvatar.tsx         ← circular, "?" default, avatar_url quando existir
│   ├── body/
│   │   ├── LeadInfoColumn.tsx
│   │   ├── InfoBlockFilled.tsx
│   │   ├── InfoBlockMissing.tsx
│   │   ├── InfoBlockTracking.tsx
│   │   └── InfoFieldRow.tsx       ← linha label/value com inline edit
│   ├── activity/
│   │   ├── LeadActivityColumn.tsx
│   │   ├── CommentComposer.tsx
│   │   └── ActivityFeed.tsx       ← intercala history + comments
│   └── index.ts                   ← re-exports
├── hooks/
│   ├── useLeadDetail.ts           ← reaproveitar
│   ├── useLeadSheet.tsx           ← reaproveitar (rename interno opcional)
│   ├── useLeadComments.ts         ← NOVO (CRUD comentários)
│   ├── useLeadAge.ts              ← NOVO (formatDistanceToNow ptBR)
│   ├── useResponsibleSelector.ts  ← NOVO (selector logic)
│   └── useQualificationSelector.ts← NOVO
├── (legado a remover ao final, mantido no PR de migração)
│   ├── LeadDetailSheet.tsx
│   ├── LeadDetailHeader.tsx
│   ├── LeadDetailProperties.tsx
│   ├── LeadDetailTimeline.tsx (renomear para ActivityFeed e mover)
│   └── LeadDetailNotes.tsx
└── index.ts                       ← re-exporta LeadDetailDialog
```

### B.3 Container — Dialog centralizado

- shadcn `<Dialog>` com overlay blur + animação fade/scale.
- `max-w-[1100px]`, `max-h-[88vh]`, `rounded-2xl`, `border border-border/40`.
- Background: `bg-card` dark-first com gradient sutil no header (`from-primary/[0.03] to-transparent`).
- `LeadPanelLayout` aposenta. Páginas que usavam viram standard sem split. Diff mínimo: importar `LeadDetailDialog` e renderizar dentro do `LeadPanelProvider` sem o `LeadPanelLayout` wrapper.
- Mobile (<768px): vira `<Sheet side="bottom">` fullscreen scrollable.

### B.4 Header — Identidade

- **Avatar** ([LeadAvatar.tsx](#)): `<Avatar>` 56px circular.
  - Default: ícone `<HelpCircle>` ou `<User>` em background neutro.
  - Se `lead.avatar_url`: `<AvatarImage src={lead.avatar_url}>`.
  - Hover/click: tooltip "Foto definida por automação (em breve)" (CTO disse: alteração via automação futura).
- **Identity stack** (vertical, gap-1):
  - `name` — `text-xl font-semibold tracking-tight`.
  - `company` — `text-sm text-muted-foreground`.
  - `phone` (formatado BR) — `text-xs text-muted-foreground/80 font-mono` + click-to-copy.
  - `age` — `text-[11px] text-muted-foreground/60` — `formatDistanceToNow(lead.created_at, { addSuffix: true, locale: ptBR })` → "há 3 dias".
- **Divider vertical** — `w-px h-16 bg-border/40` posicionado entre identity e actions.

### B.5 Header — Ações verticais (lado direito)

Stack vertical com 3 grupos, gap-3:

1. **ResponsibleSlot ×2** (Pré-Venda, Venda):
   - Default: bolinha 32px com `<Plus>` em borda dashed, hover gold.
   - Click → `<Popover>` com lista de `useResponsibleMembers()` (search + scroll).
   - Após seleção: bolinha vira `<Avatar fallback={initials(member.name)}>` 32px com cor determinística do nome. Click reabre selector.
   - Labels micro "PV" / "V" abaixo (opcional, decidir D.10).

2. **QualificationSlot ×2** (Pré-Qualificação, Qualificação):
   - Mesma mecânica das responsibilidades.
   - Opções (ordem decrescente):
     - Diamante 💎 (ícone `<Gem>`, `text-cyan-300`)
     - Ouro 🏆 (ícone `<Trophy>`, `text-amber-400`)
     - Prata (ícone `<Medal>`, `text-zinc-300`)
     - Bronze (ícone `<Award>`, `text-orange-500`)
     - Desqualificado (ícone `<XCircle>`, `text-red-500`)
   - Mapeamento valor↔coluna em **D.3** (ainda em aberto).

3. **MoveStageButton**:
   - Botão pill: `<ArrowRightCircle> Mover`.
   - Click → `<Popover>` mostrando todas stages do pipe atual (ou pipe selector se lead está em múltiplos).
   - Disparar mutation `update pipe_<variant>.stage_id` + log em `lead_history`.

### B.6 Body — Coluna esquerda (info)

3 blocos verticais separados por `<Separator>`. Scroll interno na coluna.

**Bloco 1 — Informações do formulário** ([InfoBlockFilled.tsx](#))
Mostra apenas campos preenchidos. Itera lista canônica:
```
[name, company, phone, email, origin, segment, urgency, faturamento, notes, rating(legado), <custom_fields preenchidos>]
```
- Pulando campos vazios.
- Mostra 5 primeiros + botão `Mostrar mais` (expande resto).
- Cada linha: `<InfoFieldRow label value onSave>` — usa `useInlineEdit` + `useUpdateLead`.

**Bloco 2 — Informações faltantes** ([InfoBlockMissing.tsx](#))
- Mesma lista canônica, mas filtra `valor == null || ''`.
- CTA suave por linha: `<button>+ adicionar {label}</button>` que abre inline editor.
- Vazio quando tudo preenchido → mostra check verde "Lead completo".

**Bloco 3 — Tracking** ([InfoBlockTracking.tsx](#))
Mostra:
- `origin` (badge colorido reaproveitando `ORIGIN_COLORS` de [LeadCard.tsx:38](../../../../../src/components/leads/LeadCard.tsx#L38)).
- `utm_campaign`, `utm_source`, `utm_medium`, `utm_content`, `utm_term` (campos UTM existentes em `leads`).
- `meta_ad_id`, `meta_adset_id`, `meta_campaign_id` (se origin=meta_ads).
- `import_batch_id` (se importado em lote).
- `created_at` (data absoluta com tooltip + idade).

Bloco 3 é read-only (tracking não se edita).

### B.7 Body — Coluna direita (atividade)

**CommentComposer (topo)**:
- `<Textarea rows={2}>` + botão "Comentar".
- Mantém atalho `Cmd/Ctrl+Enter`.
- Cria `lead_comment` (ou `lead_history.action='comment_added'` — ver D.7).
- Mention `@vendedor` decidir em D.11.

**ActivityFeed**:
- Reutiliza `useLeadTimeline(leadId)` adicionando comentários via `useLeadComments`.
- Eventos intercalados ordenados desc por `created_at`.
- Filtros mantidos (Todos / Manual / Copilot / Automação / Sistema / Pipeline) — adicionar **Comentários**.
- Cada comentário: avatar autor + nome + body + timestamp + (se autor=current OR admin) ações: `Editar / Apagar`.
- Soft delete: `deleted_at` setado. Renderiza placeholder "comentário apagado por X" mantendo timeline coerente. Decisão final em D.8.

### B.8 Migration nova

```sql
-- 20260517000000_lead_detail_modal_redesign.sql

-- 1. Avatar do lead
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- 2. (Opcional, depende de D.3) Pré-qualificação
-- Alternativa A: reaproveitar
--   qualification_score (0-100 auto IA) → pré-qualificação
--   rating (1-5 manual)                 → qualificação (mapeado pra Diamante..Desqualificado)
-- Alternativa B: novas colunas tier-based
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pre_qualification_tier text
    CHECK (pre_qualification_tier IN ('diamante','ouro','prata','bronze','desqualificado')),
  ADD COLUMN IF NOT EXISTS qualification_tier text
    CHECK (qualification_tier IN ('diamante','ouro','prata','bronze','desqualificado'));

CREATE INDEX IF NOT EXISTS idx_leads_pre_qualification_tier
  ON public.leads(pre_qualification_tier);
CREATE INDEX IF NOT EXISTS idx_leads_qualification_tier
  ON public.leads(qualification_tier);

-- 3. lead_comments (se decisão for separar de lead_history — ver D.7)
CREATE TABLE IF NOT EXISTS public.lead_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_team_member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_lead_comments_lead_id ON public.lead_comments(lead_id);
CREATE INDEX idx_lead_comments_org_id  ON public.lead_comments(organization_id);
CREATE INDEX idx_lead_comments_created ON public.lead_comments(created_at DESC);

ALTER TABLE public.lead_comments ENABLE ROW LEVEL SECURITY;

-- Reaproveitar helpers SECURITY DEFINER (NÃO inline SELECT FROM team_members)
CREATE POLICY "lead_comments_select_by_org" ON public.lead_comments
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

CREATE POLICY "lead_comments_insert_by_org" ON public.lead_comments
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND author_user_id = auth.uid()
  );

CREATE POLICY "lead_comments_update_by_author_or_admin" ON public.lead_comments
  FOR UPDATE
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND (author_user_id = auth.uid() OR public.is_user_admin())
  )
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

GRANT SELECT, INSERT, UPDATE ON public.lead_comments TO authenticated;
```

Migration de revert preparada em paralelo. Tipos regenerados via `supabase gen types typescript`.

### B.9 Edge fns / RPCs

- Nenhuma nova obrigatória pra v1.
- Mover stage continua via `move-pipe-record` se permission gate é ativada (ver backlog `move-pipe-record-server-side.md`); senão UPDATE direto na pipe_<variant> table (mantém comportamento atual).

### B.10 Acessibilidade

- Dialog ARIA correto (shadcn cobre).
- Focus trap, escape fecha, scroll lock no body.
- Botões ações ≥ 32px touch target.
- `aria-label` em cada slot (Pré-Venda, Venda, etc).
- Comment composer: `aria-describedby` para placeholder de atalho.
- Contraste AA dark mode.

### B.11 Responsivo

- `≥1024px`: layout completo two-column 7/5.
- `768-1023px`: header colapsa (ações viram chips horizontais), corpo single column scroll (info + atividade empilhadas).
- `<768px`: `<Sheet side="bottom">` fullscreen, tabs Info/Atividade.

### B.12 Estado / queries

| Operação | Query/Mutation | Invalidações |
|----------|----------------|--------------|
| Abrir modal | `useLeadDetail(leadId)` (cache 5min) | — |
| Editar campo | `useUpdateLead` | `lead-detail`, `leads`, `lead-timeline`, `field_changes` |
| Toggle responsible | `useUpdateLead({pre_sale_responsible_id})` | idem |
| Toggle qualification | `useUpdateLead({pre_qualification_tier, qualification_tier})` | idem |
| Mover stage | UPDATE `pipe_<variant>.stage_id` | `pipe-<variant>`, `lead-pipes`, `lead-timeline` |
| Comentar | `useCreateLeadComment` | `lead-comments`, `lead-timeline` |
| Apagar comentário | `useDeleteLeadComment` | idem |

Optimistic updates onde fizer sentido (toggle ai, responsible/qualification slots).

### B.13 Telemetria

- `useLogLeadAction` em todas mutations (já padrão).
- Eventos novos: `comment_added`, `comment_deleted`, `qualification_tier_changed`, `pre_qualification_tier_changed`, `responsible_assigned` (já existe parecido).
- Sentry breadcrumbs no Dialog open/close.

---

## C — Spec implementável (resumo prático para subagents)

### C.1 Etapas (ordem sugerida)

1. **DB**: migration `20260517000000_lead_detail_modal_redesign.sql` (dev primeiro). Regen types.
2. **Hooks**: `useLeadComments`, `useLeadAge`, `useResponsibleSelector`, `useQualificationSelector` + mutations.
3. **Componentes header**: `LeadAvatar` → `LeadIdentityBlock` → `ResponsibleSlot` → `QualificationSlot` → `MoveStageButton` → `LeadModalHeader`.
4. **Componentes body**: `InfoFieldRow` → `InfoBlockFilled/Missing/Tracking` → `LeadInfoColumn`.
5. **Componentes activity**: `CommentComposer` → `ActivityFeed` (fundir com timeline) → `LeadActivityColumn`.
6. **Root**: `LeadDetailDialog` substitui `LeadDetailSheet`. Atualizar `index.ts`.
7. **Páginas**: remover `LeadPanelLayout` dos 13 call sites, manter `LeadPanelProvider` + montar `<LeadDetailDialog />` ao lado.
8. **Mobile fallback**: Sheet bottom variant.
9. **Testes**: unit `useLeadComments`, integration `lead_comments` RLS, e2e abrir modal + comentar + mover stage.
10. **Vault**: criar `06 — Features/Vendas/Lead Detail Modal.md`, ADR, changelog.
11. **Deprecate**: remover `LeadDetailSheet`, `LeadDetailHeader`, `LeadDetailProperties`, `LeadDetailNotes`, `LeadDetailTimeline` (renomeado), `LeadPanelLayout`.

### C.2 Props chave

```ts
// LeadDetailDialog (root, sem props — consome useLeadSheet)
export function LeadDetailDialog(): JSX.Element;

// LeadModalHeader
interface LeadModalHeaderProps {
  lead: LeadWithRelations;
  variant: DrawerVariant;
  onClose: () => void;
}

// ResponsibleSlot
interface ResponsibleSlotProps {
  leadId: string;
  field: "pre_sale_responsible_id" | "sale_responsible_id";
  label: "Pré-Venda" | "Venda";
  currentMember: { id: string; name: string; avatar_url?: string | null } | null;
}

// QualificationSlot
interface QualificationSlotProps {
  leadId: string;
  field: "pre_qualification_tier" | "qualification_tier";
  label: "Pré-Qualificação" | "Qualificação";
  current: QualificationTier | null;
}
type QualificationTier = "diamante" | "ouro" | "prata" | "bronze" | "desqualificado";

// MoveStageButton
interface MoveStageButtonProps {
  leadId: string;
  variant: DrawerVariant;
  currentStageId: string | null;
  pipeData: unknown;
}

// LeadInfoColumn
interface LeadInfoColumnProps { lead: LeadWithRelations; }

// LeadActivityColumn
interface LeadActivityColumnProps { leadId: string; organizationId: string; }
```

### C.3 Edge cases

- Lead sem `phone` → linha telefone esconde, slot WhatsApp some.
- Lead sem `company` → linha some.
- Lead sem responsáveis → bolinha "+" em ambos slots.
- Lead em múltiplos pipes → `MoveStageButton` mostra picker de pipe antes de stages.
- Comentário longo → scroll interno do item, truncate 6 linhas + "ler mais".
- Comentário do current user apagado → ainda renderiza placeholder.
- Avatar URL inválida → fallback automático para iniciais; se sem name, fallback para "?".
- Timeline vazia → empty state com CTA "deixar primeiro comentário".

---

## D — Dúvidas / decisões abertas

1. **Modal centralizado substitui ou coexiste?**
   - Recomendação: **substituir**. Modal duplo gera dívida de manutenção, fragmenta UX. Side panel atual não tem fan-base interno.

2. **Avatar do lead — upload manual já agora ou só campo aguardando automação?**
   - Spec do CTO: "alterar foto através de automações posteriores". → coluna `avatar_url text` sem UI de upload na v1. Apenas exibir se preenchida (por automação futura). Recomendação: **só campo + render**.

3. **Pré-qualificação vs qualificação — schema novo (tiers) ou reaproveitar `rating`/`qualification_score`?**
   - Alt A: reaproveitar `qualification_score` (0–100 auto IA) → pré-qual + `rating` (manual) → qual. Mapear ranges: Diamante 81-100, Ouro 61-80, Prata 41-60, Bronze 21-40, Desqualificado ≤20 (ou explicit set).
   - Alt B: novas colunas tier `pre_qualification_tier` + `qualification_tier` (enum string). Limpo, sem coupling com escala numérica.
   - **Recomendação: Alt B** — semântica clara, drift entre número e tier vira problema; tier deve ser nominal. Migrar `rating` → `qualification_tier` via backfill (rating≥9 → diamante, 7-8 → ouro, 4-6 → prata, 1-3 → bronze, 0 → null). Manter `rating` legado por 1 release pra dashboards/exports legados.

4. **"Idade do lead" — formato relativo, absoluto ou ambos?**
   - Recomendação: **relativo no header** ("há 3 dias") + **tooltip com data absoluta** ("17 mai 2026, 10:03"). Padrão Linear/Stripe.

5. **Mostrar mais — quantos campos visíveis antes de colapsar?**
   - Recomendação: **5** no bloco preenchidos; **3** no bloco faltantes; tracking sempre todo (compacto).

6. **Histórico + comentários: intercalado ou tabs separadas?**
   - CTO disse "histórico do lead, ... mas também com a opção de deixar comentários" — sugere **mesma coluna intercalada**.
   - Recomendação: **intercalado** com filtro pra ver só comentários quando precisar. Trello faz assim.

7. **Comentários: tabela própria `lead_comments` ou `lead_history.action='comment_added'`?**
   - Alt A: `lead_comments` (limpo, dedicado, soft-delete nativo, FK author, melhor pra editar/reagir).
   - Alt B: reusar `lead_history` (notes já vivem lá).
   - **Recomendação: Alt A — tabela própria**. CTO pediu apagar comentários e isso conflita com append-only de `lead_history`. Renderização unificada na coluna de atividade é fácil (UNION ALL no hook).

8. **Permissão pra apagar comentário?**
   - Recomendação: **autor sempre + admin/master**. Membro não admin não apaga comentário alheio.

9. **Permissão pra mover stage?**
   - Hoje: `move-pipe-record` gated por permission (ver backlog `move-pipe-record-server-side`). Manter mesmo gate.

10. **Labels "PV/V" e "PQ/Q" microcopy nos slots — usar ou só tooltip?**
    - Recomendação: **só tooltip + ícone discreto**. Reduz ruído visual, mantém clean.

11. **Menção `@vendedor` em comentários e notificações?**
    - Recomendação: **fora do escopo v1**. Anotar no backlog para v2.

12. **Mobile: Sheet bottom fullscreen ou modal scrollable centralizado?**
    - Recomendação: **Sheet side=bottom fullscreen** com tabs Info/Atividade. Padrão iOS/Android.

13. **Botão "Mover" — abre seletor de stage do pipe atual apenas, ou também permite mover entre pipes?**
    - Recomendação v1: **stage do pipe atual** (variant). Move entre pipes via menu dropdown adicional ou fora do escopo. CTO falou "mover o lead pelo kanban" → ambíguo.

14. **Manter ações secundárias (WhatsApp/Ligar/Email/FUP/Toggle IA) — onde?**
    - Spec do CTO descreve apenas Responsáveis + Qualificações + Mover no header. Mas WhatsApp/Ligar/Email/IA são fundamentais.
    - Recomendação: **toolbar horizontal embaixo do header** (acima do body) com botões compactos. Toggle IA + menu kebab pra ações raras (Excluir, Email com IA, SMS, Agendar mensagem).

15. **Conversation history tab existente** ([ConversationHistoryTab.tsx](../../../../../src/components/leads/ConversationHistoryTab.tsx)) — incluir no novo modal?
    - Recomendação: **incluir como sub-tab dentro da coluna direita** ("Atividade" / "Conversas" / só atividade default). Decidir se essential v1 ou v2.

16. **Tags/Etiquetas — onde no novo layout?**
    - Recomendação: **chips embaixo do nome no header** (logo abaixo da idade), compactos. Editáveis via popover ao clicar em "+".

17. **Faturamento/Segmento/Urgência — campos do form devem aparecer também como badges no header (como hoje)?**
    - Recomendação: **só dentro do bloco 1 (info)**. Header fica limpo. Apenas tags como badges visuais externos.

18. **Stage progress bar** atual ([StageProgressBar.tsx](../../../../../src/components/lead-detail/StageProgressBar.tsx)) — manter?
    - Recomendação: **mover para dentro do popover do botão Mover**. Mostra contexto do funil só quando relevante.

19. **Backfill: leads existentes — qual avatar default?**
    - Recomendação: **null** (renderiza ícone "?" no UI). Sem backfill.

20. **Cache de bolinhas de responsáveis** — quando vendedor é selecionado, mostrar avatar dele se `team_members.avatar_url` existir, ou só inicial?
    - Recomendação: **avatar se existir, inicial como fallback**. Reaproveita `team_members.avatar_url` já existente.

---

## E — Não-objetivos / fora do escopo v1

- Menções `@user` + notificações push.
- Reactions em comentários (👍 ❤️).
- Rich text/markdown no comentário (apenas plain text + newlines).
- Anexos em comentários.
- Histórico de edição de comentário (só created_at + updated_at).
- Audit log dedicado de quem apagou cada comentário (deleted_by basta).

---

## F — Critérios de aceite (UAT)

- [ ] Modal abre centralizado, dark-first, 88vh max, sem layout shift.
- [ ] Avatar "?" default, troca pra URL quando preenchida via SQL manual.
- [ ] Nome/empresa/telefone/idade-do-lead visíveis no header com tipografia clean.
- [ ] Divisor vertical fino entre identidade e ações.
- [ ] 2 slots de responsáveis funcionam (+ → seletor → inicial).
- [ ] 2 slots de qualificação funcionam com 5 tiers em ordem decrescente.
- [ ] Botão Mover abre seletor de stage do pipe atual.
- [ ] Coluna info: 3 blocos verticais (preenchidos / faltantes / tracking).
- [ ] "Mostrar mais" expande blocos.
- [ ] Coluna direita: composer + feed intercalado.
- [ ] Comentário criado aparece imediato (optimistic).
- [ ] Comentário apagável pelo autor; admin apaga qualquer.
- [ ] Mobile: Sheet bottom funciona, todos campos acessíveis.
- [ ] Acessibilidade: navegação por tab, escape fecha, foco trap.
- [ ] Performance: open < 200ms p95, sem CLS.
- [ ] Todos os 13 call sites continuam funcionando sem alteração de API.
- [ ] RLS de `lead_comments` testada (org A não vê comentário de org B).
- [ ] Migration aplica sem dor; revert preparada.
