---
title: "Slice 3 (completar) — Catálogo de tools: writes restantes + mídia"
feature: copilot-v2-remodel
slice: "3"
phase: "B — Capabilities core"
status: brief
depends_on: ["[[slice-1H-harness-hardening]]"]
soft_depends_on: ["[[slice-05-guardrails-handoff]]", "[[slice-07-ingestion-rag]]"]
branch: feat/copilot-v2/slice-3-tools-media
handoff: "design (UX tool/gatilho no wizard) → engenheiro"
security: true
tags: [copilot-v2, slice, brief, media]
---

# Slice 3 (completar) — Tools restantes + mídia 🔒

> **Brief de execução.** Detalhe bite-sized TDD a escrever via `superpowers:writing-plans` quando desbloqueado (depende de [[slice-1H-harness-hardening]]). Mapa: [[_MOC]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Goal
Implementar os 4 handlers `not_implemented` do tool-executor v2 + envio de áudio, com mídia consistente e write-after-introspect.

## Escopo (merge SPEC #3/#6 + auditoria + emenda áudio)
- **`send_media`**: resolve item de `copilot_v2_send_media` → delega ao adapter WhatsApp (`_shared/whatsapp-client.ts`). Suporta `image | video | audio(ptt)` [**emenda ADR §5/§12**]. Gate antes do envio (já-enviou? momento certo?). **Fallback explícito sem silent-drop** quando asset indisponível/não-ready (lição do incidente VitrineVET — o v1 dropava a media-directive em silêncio, #6).
- **Detecção/normalização de media-type única** (helper MIME centralizado) — consistência cross-tipo (mata a heurística multi-camada do v1 `send_document`).
- **`handoff_to_vendedor`**: reassign + dispara notificação (usa infra de [[slice-05-guardrails-handoff]]).
- **`schedule_meeting` + `check_agenda_availability`**: Google Calendar adapter (`src/modules/integrations`), write-after-introspect (`check_agenda_availability` antes do `schedule_meeting`) → grava `pipe_confirmacao`.
- **`search_knowledge`**: consulta `copilot_v2_knowledge_chunks` (depende de [[slice-07-ingestion-rag]] popular os chunks).

## Touches
`_shared/copilot-v2/tool-executor.ts`, `tool-registry.ts`, `_shared/whatsapp-client.ts`, `copilot_v2_send_media`, integrations/Google Calendar.

## Exit
Cada arquétipo envia cada tipo (foto/áudio/vídeo/doc) consistente no dev; write em stage/campo inexistente → bloqueado pelo introspect-guard; agendamento cria `pipe_confirmacao`. Counts literais.

## 🔒 Segurança
org do ctx (nunca LLM); envio de mídia via signed URL; Calendar OAuth scoping.
