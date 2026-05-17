---
title: 2026-05-17 — Lead Detail Modal Redesign
type: changelog
status: shipped
created: 2026-05-17
updated: 2026-05-17
date: 2026-05-17
related:
  - "[[ADR-2026-05-17-lead-detail-modal-redesign]]"
  - "[[Lead Detail Modal]]"
---

# 2026-05-17 — Lead Detail Modal Redesign

Substitui split-pane lateral por modal centralizado Trello-inspired.

## Schema

- `leads.avatar_url text` — campo de foto, populado por automação (sem UI upload).
- `leads.pre_qualification_tier qualification_tier` — Diamante/Ouro/Prata/Bronze/Desqualificado.
- `leads.qualification_tier qualification_tier` — idem (separação Pré-Venda × Venda).
- Backfill: `rating` → `qualification_tier` (9-10→diamante, 7-8→ouro, 4-6→prata, 1-3→bronze).
- Tabela `lead_comments` (id, org_id, lead_id, author_user_id, author_team_member_id, body, created_at, updated_at, deleted_at, deleted_by).
- RLS: SELECT/INSERT via `get_my_organization_ids()`. UPDATE: autor ou `is_user_admin()`.
- Trigger `fn_log_lead_comment_event` → registra `comment_added`/`comment_deleted` em `lead_history`.

Migration: `supabase/migrations/20260517000000_lead_detail_modal_redesign.sql`.

## Frontend

- Novo módulo `src/components/lead-detail/modal/`.
- `LeadDetailDialog` (Dialog centralizado + Sheet bottom em mobile).
- Header: identidade + 2× responsável + 2× qualificação + Mover.
- Toolbar: WA/Ligar/Email/FUP/IA + kebab.
- Body 7+5: 3 blocos info (preenchidos/faltantes/tracking) + atividade intercalada (timeline + comentários).
- `useLeadComments` (query + create/update/delete mutations).
- `LeadPanelLayout` virou no-op wrapper (zero churn nos 13 call sites).
- Componentes legados `LeadDetailSheet/Header/Properties/Notes/Timeline` ficam órfãos por uma release.

## Pendente

- Aplicar migration em prod (requer autorização CTO).
- Regen `src/integrations/supabase/types.ts` (`supabase gen types typescript --project-id <ref>`).
- Remover componentes legados após smoke em prod.

## Refs

- ADR: [[ADR-2026-05-17-lead-detail-modal-redesign]]
- Feature: [[Lead Detail Modal]]
- Spec original + dúvidas: [[lead-detail-modal-redesign]] em `08 — Backlog/em-progresso/`
