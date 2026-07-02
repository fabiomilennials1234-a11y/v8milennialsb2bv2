---
type: backlog
title: Meta Chat — FASE 0
status: shipped
created: 2026-05-25
updated: 2026-05-25
tags: [meta-chat, messenger, instagram, communication]
related:
  - "[[ADR-2026-05-25-meta-chat-canal-separado]]"
owner: gabriel
---

# Meta Chat — FASE 0

> [!success] COMPLETE — 2026-05-25
> Implementação completa e **merged em `main`** via PR #449 (commit `5483695d` — "feat(meta-chat): FASE 0 — chat Messenger + Instagram em rota dedicada"). Chat Messenger + Instagram Direct em `/atendimento/meta`, isolado do `/chat` WhatsApp. Follow-ups de FASE 0.5/FASE 1 listados ao final continuam abertos. Decisão de canais separados em [[ADR-2026-05-25-meta-chat-canal-separado]].

**Status:** ✅ COMPLETE 2026-05-25 (merged main via PR #449)
**Card Trello:** "Meta Integração | FASE 0" (Urgente)
**Owner:** Marcelo Montemezzo

## Escopo
Habilitar receber+responder mensagens Messenger e Instagram Direct dentro do Torque, rota dedicada `/atendimento/meta`, isolado do chat WhatsApp.

## Decisões
- **Canais separados** (não omnichannel) — decisão registrada em ADR-2026-05-25.
- Backend Meta já existe (oauth, webhook, send, leadgen). Só falta camada conversation + UI.

## Documentos
- Spec: [`docs/superpowers/specs/2026-05-25-meta-chat-fase-0-design.md`](../../../../../docs/superpowers/specs/2026-05-25-meta-chat-fase-0-design.md) (13 seções)
- Plan: [`docs/superpowers/plans/2026-05-25-meta-chat-fase-0.md`](../../../../../docs/superpowers/plans/2026-05-25-meta-chat-fase-0.md) (34 tasks)

## Roadmap resumido (7 sub-fases)
1. Infra DB: migration table + trigger + RLS + índices + backfill (Tasks 1-3, 6)
2. Edge fns + RPCs: meta-conversation-profile + mark_read + link_lead (Tasks 4-5, 7)
3. Hooks: types + 8 hooks com unit tests (Tasks 8-17)
4. UI lista + rota + sidebar gate (Tasks 18-22, 30-31)
5. UI thread + composer + janela 24h (Tasks 23-26)
6. LinkLead + mark-read + profile enrichment (Tasks 27-29)
7. QA + docs: E2E Playwright + smoke Meta real + Obsidian (Tasks 32-34)

## Critério de aceite
- Cliente loga Facebook/Instagram em Settings → conexão funcional (já existe).
- Formulários Lead Ads aparecem listados (já existe).
- Mensagens IG Direct + Messenger aparecem em `/atendimento/meta` em tempo real.
- Cliente responde, msg chega no IG/Messenger.
- Vincular conversa a lead existente ou criar novo.
- Zero regressão no `/chat` WhatsApp.

## Out of scope (fases futuras)
- Omnichannel unificado
- Dashboard Torque MKT / métricas
- Conversion API feedback loop (qualificação → audiência)
- Migração `meta-ads-insights` multi-tenant (env → OAuth)
- Composer extras: stickers, reactions, voice, story replies, comments
- Message tags fora da janela 24h

## Branch
`feat/meta-chat-fase-0/spec` — contém spec + plan commitados. Sub-tasks serão executadas em branches filhas `feat/meta-chat-fase-0/<task-slug>` por sub-agente engenheiro/design sob orquestração do arquiteto.

## Status execução — 2026-05-25

**Implementação completa.** 39 commits em 7 branches stacked. Build green, lint clean, zero regressão em /chat WhatsApp. Final code review = READY_WITH_FOLLOWUPS.

Branch stack (cada uma off da anterior):
- `feat/meta-chat-fase-0/spec` (docs)
- `feat/meta-chat-fase-0/infra-db` (10 commits — migrations + integration tests)
- `feat/meta-chat-fase-0/edge-fn` (4 commits — edge fn + types augmentation manual)
- `feat/meta-chat-fase-0/hooks` (9 commits — 8 hooks + types em src/hooks/chat-meta/)
- `feat/meta-chat-fase-0/ui-list` (7 commits — EmptyState/Skeleton/List/Header + page stub + sidebar gate)
- `feat/meta-chat-fase-0/ui-thread` (4 commits — Bubble/MessageList/WindowWarning/Composer)
- `feat/meta-chat-fase-0/shell` (3 commits — LinkLeadDialog + MetaChatShell + page wired)
- `feat/meta-chat-fase-0/qa-docs` (2 commits — E2E spec + docs)

PR strategy recomendada: **1 PR squashed** (stack tem dependências fortes; squash-merge de stack tem footgun conhecido — ver MEMORY).

## Spec gap conhecido (FASE 0.5 ou follow-up imediato)
- LinkLeadDialog NÃO tem flow "criar novo lead a partir desta conversa" (spec §5.3, §13.6). Cliente pode vincular existente mas não criar novo dali. Workaround: criar lead manualmente em /leads e depois vincular.

## Follow-ups identificados para FASE 1
1. Drop `as any` + manual types block após regen baseline dev.
2. View `meta_pages_safe` (sem `page_access_token`) + trocar SELECTs frontend pra ela. Leak pré-existente.
3. Create-new-lead em LinkLeadDialog (origin=`meta_chat`).
4. Optimistic updates em useMetaSend + failed-state rollback (erro #10).
5. Cursor-based DESC pagination + infinite scroll em useMetaMessages/MetaMessageList.
6. Virtualização lista conversas + tab Arquivadas.
7. Debounce search em LinkLeadDialog.
8. Composer null-inbound state — "Aguardando primeira mensagem" vs disable silencioso.
9. Realtime invalidation scoping — filtrar por channel in (messenger,instagram) pra reduzir refetch wasted.
10. Traduzir códigos erro Meta no useMetaSend (especialmente #10 janela 24h).
11. RAISE NOTICE no trigger quando meta_page lookup falha (atualmente silencioso).
12. Opcional: PermissionProtectedRoute em /atendimento/meta pra paridade com /chat.
