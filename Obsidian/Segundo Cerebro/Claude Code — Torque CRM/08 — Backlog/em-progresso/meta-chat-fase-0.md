# Meta Chat — FASE 0

**Status:** Planejado, pronto pra executar.
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
