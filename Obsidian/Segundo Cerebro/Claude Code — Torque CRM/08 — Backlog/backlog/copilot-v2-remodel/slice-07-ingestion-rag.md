---
title: "Slice 7 — Ingestão + RAG + auditoria de mídia inbound"
feature: copilot-v2-remodel
slice: "7"
phase: "B — Capabilities core"
status: brief
depends_on: ["[[slice-1H-harness-hardening]]"]
branch: feat/copilot-v2/slice-7-ingestion-rag
handoff: "engenheiro"
security: true
tags: [copilot-v2, slice, brief, rag, media]
---

# Slice 7 — Ingestão + RAG + audit inbound 🔒

> **Brief de execução.** Detalhe via `superpowers:writing-plans` quando desbloqueado. Mapa: [[_MOC]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Goal
Pipeline mídia→texto + busca híbrida (`search_knowledge`) + endurecer o caminho de mídia inbound.

## Escopo (SPEC #7 + auditoria inbound)
- **Ingestão media→texto**: doc/pdf extrai+chunk; imagem OCR/caption; vídeo transcrição → embed pgvector → `search_knowledge`.
- **Hybrid search** (semântico + keyword) + reranking + **threshold centralizado** (consolidar — a v1 tinha 3 divergentes: rag 0.6, search-knowledge 0.55, retriever 0.5).
- **RPCs `match_*` org-scoped** (#40/#41 — adicionar predicate `organization_id`, não confiar só no `agent_id`).
- **Inbound border media→texto auditado**: validar `OPENROUTER_API_KEY` no entry; retry + telemetria na transcrição (sem fallback silencioso que esconde credencial faltando); **fix doc travado em `processing`** (timeout guard + transição de status determinística).
- Falha de embedding/RAG **não-silenciosa** (trace).

## Touches
pipeline de ingestão (edge), `copilot_v2_knowledge`+`_chunks`, RPCs `match_document_chunks`/`match_faqs`/`match_lead_memories`, border media→texto.

## Exit
PDF de catálogo responde à spec; imagem de ficha técnica vira texto buscável; doc nunca trava em processing; falha de embedding aparece no trace; RPC cross-org bloqueada (teste RLS).

## 🔒 Segurança
RPC org-scope, custo de ingestão.
