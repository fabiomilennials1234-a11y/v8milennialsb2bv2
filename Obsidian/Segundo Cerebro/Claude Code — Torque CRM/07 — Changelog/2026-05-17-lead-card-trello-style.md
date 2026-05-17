---
date: 2026-05-17
type: feature
status: implementado-dev
related:
  - "[[Lead Card]]"
  - "[[Lead Detail Modal]]"
---

# 2026-05-17 — Lead Card Trello-style

Refactor visual completo do card do kanban + layout wide.

## Frontend

- `LeadCard.tsx` virou orchestrator. Subcomponentes em `src/components/leads/card/`.
- **LeadCardAvatar** (32px) — split tier (preQual esquerda / qual direita), reaproveita config do modal.
- **LeadCardLabels** — color stripes top 3 + counter `+N`, tooltip com nomes.
- **LeadCardMetrics** — inline: comments, checklist X/Y, attachments (placeholder), 2 mini avatars (PV+V).
- **LeadCardCalor** — fogo arrastável vertical, formato + cor mudam com intensidade (frio→ardente).
- `useBatchedLeadMetrics(leadIds[])` — 2 queries `IN(...)` agregando comments + checklists. Cache 30s.
- `usePipelineEntries` LEAD_SELECT atualizado: `avatar_url, pre_qualification_tier, qualification_tier, team_members.avatar_url`.
- Call sites principais (`PipeWhatsapp`, `PipeConfirmacao`, `PipePropostas`) atualizados com novos campos.

## Layout

- `MainLayout`: nova categoria `WIDE_LAYOUT_PATTERNS` para kanbans — sem `max-w-[1600px]`, padding reduzido. Aplicado em `/pipe-*`, `/leads`, `/custom-pipeline`, `/campanhas`, `/upsell`, `/follow-ups`.
- `PipeWhatsapp`: toggle "Recolher métricas" persistido em localStorage. Stats bar (4 cards) colapsa.

## Refs

- Feature: [[Lead Card]]
- ADR relacionado: [[ADR-2026-05-17-lead-detail-modal-redesign]] (mesmo padrão visual)
