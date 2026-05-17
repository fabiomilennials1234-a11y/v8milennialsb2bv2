---
title: ADR-2026-05-17 — Lead Detail Modal Redesign
date: 2026-05-17
status: accepted
authors: [CTO, claude-arquiteto]
---

# ADR-2026-05-17 — Lead Detail Modal Redesign

## Contexto

O modal de detalhes do lead vivia em split-pane lateral (`LeadPanelLayout` ocupando 45% da viewport). Tipografia ~10-11px, informações comprimidas em sidebar com 6 PropertyGroups colapsáveis + abas Atividade/Notas. Difícil de escanear, padrão visual datado.

CTO definiu remodelagem completa inspirada em Trello: modal centralizado, header proeminente, corpo two-column equilibrado.

## Decisão

Substituir o split-pane por **Dialog centralizado** (`LeadDetailDialog`). Mobile vira `Sheet side="bottom"` fullscreen.

### Identidade × ações no header
- Esquerda: avatar circular (default `?` → automação preenche `avatar_url`) + nome/empresa/telefone/idade.
- Divisor vertical.
- Direita: 2 slots de responsáveis (Pré-Venda + Venda) + 2 slots de qualificação (Pré-Qualificação + Qualificação) + botão Mover.

### Qualificação como tier nominal
Novas colunas `pre_qualification_tier` e `qualification_tier` (enum `qualification_tier`: diamante > ouro > prata > bronze > desqualificado).

**Por que não reaproveitar `rating` / `qualification_score`?** Drift entre número (1-10 ou 0-100) e tier nominal é fonte de bugs. Tier é categórico — modelar como tal.

`rating` legado mantido por uma release; backfill aplicado (9-10→diamante, 7-8→ouro, 4-6→prata, 1-3→bronze).

### `lead_comments` como tabela própria
- Soft-delete (`deleted_at`/`deleted_by`).
- Edição (`updated_at`).
- RLS via `get_my_organization_ids()` + `is_user_admin()` (sem inline SELECT em `team_members` — gotcha de recursão RLS/Realtime).
- Trigger sincroniza `comment_added` / `comment_deleted` em `lead_history` automaticamente.

**Por que não reusar `lead_history`?** History é append-only de fato — comentários precisam editar/apagar. Mesclar gera fricção. Render unificado vem do hook que faz merge ordenado.

### Histórico + comentários intercalados
Mesma coluna direita. Filtros: Todos / Comentários / Manual / Copilot / Automação / Sistema / Pipeline. Trello faz assim — usuário vê narrativa completa sem alternar tabs.

### Toolbar de ações secundárias
Logo abaixo do header: WhatsApp · Ligar · Email · Follow-up · IA toggle · kebab (registrar ligação, email IA, agendar msg, abrir conversa, SMS, excluir).

Header fica limpo focando em identidade + atribuição + qualificação + movimentação.

### Avatar sem UI de upload
v1 só campo `avatar_url`. Automação futura (enriquecimento, scraping, Meta Ads picture) preenche. Decisão explícita do CTO.

### `LeadPanelLayout` vira no-op
Em vez de tocar 13 call sites, refatoramos o wrapper para renderizar `children` + `panel` lado a lado (panel = Dialog gerencia portal próprio). Zero diff nas páginas.

## Alternativas consideradas

1. **Modal lateral mantido + redesign visual** — descartado. Pediu remodelagem.
2. **Coexistir lateral + centralizado** — descartado. Dívida de manutenção.
3. **Reusar `rating` como qualification_tier numérico** — descartado. Tier é nominal.
4. **Comentários em `lead_history`** — descartado. Edit/delete não combina com append-only.

## Consequências

- Migration `20260517000000_lead_detail_modal_redesign.sql` adiciona 3 colunas + tabela + RLS + trigger.
- Types.ts precisa regen após apply (`supabase gen types typescript`).
- Componentes legados (`LeadDetailSheet.tsx`, `LeadDetailHeader.tsx`, `LeadDetailProperties.tsx`, `LeadDetailNotes.tsx`, `LeadDetailTimeline.tsx`) ficam órfãos mas não removidos imediatamente — manter por uma release para reverter rápido se preciso.
- `useLeadComments` hook usa cast `any` até regenerar types.
- API `useLeadSheet().openLead(id, variant, pipeData?)` inalterada — 13 call sites zero churn.
- Backlog: spec/dúvidas em [[lead-detail-modal-redesign]] (`08 — Backlog/em-progresso/`).

## Próximos passos

- Aplicar migration em prod com autorização CTO.
- Regenerar types.
- Remover componentes legados após uma release sem regressão.
- Considerar v2: menções, reactions, anexos.
