---
type: changelog
title: Copilot — handoff pegajoso e texto do turno de transferência
status: in-progress
created: 2026-10-13
updated: 2026-10-13
tags: [changelog, copilot, whatsapp, handoff]
related: []
owner: claude-agent
---

# 2026-10-13 — Copilot: handoff pegajoso e texto do turno de transferência

## Mudanças
- **Copilot / H1**: texto do turno com transferência deixa de ser descartado. Engine devolve `same_turn_handoff` quando o plano tem `TRANSFER_HUMAN`/`TRANSFER_SZ_CHAT`; gate pós-LLM e gates por chunk liberam só o cancelamento idêntico a esse carimbo. Absorb loop não roda após handoff. Resposta pública do agent-message passa a levar `lead_id` e `same_turn_handoff`.
- **Copilot / H2**: `phone_ai_preferences.disabled_reason` (`'handoff'`). Trigger e RPC de transferência gravam o motivo; RPC também desliga a preferência de lead já desligado. Religação no inbound não toca `'handoff'`.
- **Backfill (não aplicado)**: B1 349 prefs → `'handoff'`; B2a 118 travados em WAITING_HUMAN → pref desligada; B2b 26 → lead alinhado à pref. Contagens de prod em 2026-10-13.

## Arquivos tocados
- `supabase/migrations/20271120000000_copilot_handoff_disabled_reason.sql` — coluna + trigger fn + RPC (rollback em `rollback/`).
- `scripts/copilot-handoff-backfill-20271120.sql` — backfill idempotente (BEGIN…COMMIT) com backup em `backup.copilot_handoff_backfill_20271120`. Script, não migration (guarda F4). Ordem obrigatória: migration `20271120000000` → deploy das 5 edges (agent-message, whatsapp-webhook, copilot-batch-processor, recover-stuck-conversations, sz-chat-webhook) → ensaio BEGIN…ROLLBACK lendo o NOTICE → aplicar → conferir `has_function_privilege` da RPC `transfer_lead_to_human`. Edge antiga religaria B1/B2a no próximo inbound.
- `supabase/functions/_shared/copilot/cancellation.ts` — `systemDisabled` exige motivo NULL; fail-safe sem a coluna; guarda na religação.
- `supabase/functions/_shared/copilot/reply-gate.ts` — gate compartilhado da resposta de texto.
- `supabase/functions/agent-message/post-llm-gate.ts`, `index.ts`, `agent-engine.ts` — carimbo, decisão pós-LLM, absorb, resposta pública.
- `supabase/functions/{whatsapp-webhook/handler.ts,copilot-batch-processor,recover-stuck-conversations,sz-chat-webhook}` — gates por chunk.
- `src/integrations/supabase/types.ts` — coluna nova (edição manual mínima até a migration subir).

## Decisões
- `set_by` não prova desligamento pelo sistema (COALESCE no trigger); sentinela impossível (FK auth.users) → coluna de motivo.
- RPC usa `ON CONFLICT … DO UPDATE … WHERE NOT ai_disabled` (equivale ao CASE decidido, sem escrita no-op que dispara trigger/realtime).

## Follow-ups
- Ordem de deploy: migration `…000000` → edge functions → ensaio transacional do backfill → backfill.
- Aviso ao CS das 12 orgs afetadas.
- Fora de escopo: delete de 60 s sem `lastAssistantMessageId`; absorb loop sem gate fora do handoff; carimbo divergente em `qualify-lead.ts:76`; toggles que religam via preferência sem lead não limpam `disabled_reason` (inócuo enquanto `ai_disabled=false`).
