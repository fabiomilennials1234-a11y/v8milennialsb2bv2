---
title: "Slice 6 — Acervos separados: send-media (incl. áudio) + knowledge base"
feature: copilot-v2-remodel
slice: "6"
phase: "B — Capabilities core"
status: brief
depends_on: ["[[slice-1H-harness-hardening]]"]
branch: feat/copilot-v2/slice-6-asset-stores
handoff: "design (biblioteca UI: upload/gatilho/preview) → engenheiro"
security: true
tags: [copilot-v2, slice, brief, media]
---

# Slice 6 — Acervos separados (send-media + KB) 🔒

> **Brief de execução.** Detalhe via `superpowers:writing-plans` quando desbloqueado. Mapa: [[_MOC]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Goal
Duas bibliotecas org-level distintas, nunca conflatadas: send-media (enviada crua) vs knowledge base (ingerida→texto, nunca enviada crua).

## Escopo (SPEC #6/#12 + emenda áudio)
- **Send-media library**: `image | video | audio(ptt)` [**emenda ADR**], org-level, `{arquivo, o que é, gatilho estruturado, nuance}`, seleção + gatilho por arquétipo. Enviada crua via `send_media` + gate. **Rever o cap "≤5"** pra acomodar áudio (ex.: ≤5 por tipo, ou ≤8 total — **decisão de produto no design**).
- **Knowledge base**: separada, org-level, `image | video | doc | pdf` → ingerida ([[slice-07-ingestion-rag]]), nunca enviada crua.
- **Migração conceitual**: não reaproveitar a conflação `copilot_agent_documents` da v1.

## Touches
`copilot_v2_send_media` (add `kind=audio`), `copilot_v2_agent_media`, storage buckets, UI de biblioteca.

## Exit
Mídia (incl. áudio) dispara só no gatilho certo; KB nunca enviada crua; trocar catálogo na org reflete nos 3 arquétipos.

## 🔒 Segurança
storage org-scoped, validação MIME.

## Decisão aberta
Cap da biblioteca send-media pra acomodar áudio (≤5/tipo vs ≤N total) — resolver no design antes de migration.
