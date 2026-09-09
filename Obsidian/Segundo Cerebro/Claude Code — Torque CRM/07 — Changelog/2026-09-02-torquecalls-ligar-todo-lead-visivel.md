---
type: changelog
title: "TorqueCalls: botão Ligar em todo lead visível (chat, lead, negócio, celular)"
status: shipped
created: 2026-09-02
updated: 2026-09-02
tags: [changelog, torquecalls, voz, permissoes, seguranca]
related: []
owner: gabriel
branch: fix/torquecalls-ligar-todo-lead-visivel
pr: pendente
---

# 2026-09-02 — TorqueCalls: ligar para todo lead visível

## TL;DR

O botão Ligar sumia para o SDR no chat por um **gate de dono do lead** (front + servidor) que
lia colunas legadas e era mais estreito que a própria leitura de `voip_calls`. Regra nova, fechada
pelo CTO: **vê o lead → pode ligar**. Servidor confere a RLS de `leads` com o JWT do chamador
(`lead_not_visible`). O botão passa a existir no Card do Lead, no Card do Negócio e no chat do
celular. A leitura (`voip_can_see_call`) passa a olhar o dono canônico.

## Mudanças
- **voz/servidor**: `Caller.asUser` (cliente user-scoped) em `_shared/voip/caller.ts`; bloco 2b de `call-plane.ts` troca `not_lead_owner` por `lead_not_visible` via RLS; `torquecalls-signal` devolve 403 para o código novo.
- **voz/front**: `useCanCallLead` apagado; `VoiceCallButton` ganha `variant="icon"`; mensagem "Você não tem acesso a este lead.".
- **superfícies**: `LeadCard` (slot `acaoLigar`, substitui botão morto), `DealCard` (slot no cluster Ganhou/Perdeu), `MobileChatThreadHeader`.
- **DB**: `20270915000000_voip_can_see_call_por_dono_canonico.sql` — `can_see_lead_by_permissions(pre_sale_responsible_id, sale_responsible_id)` em vez das legadas; rollback em `migrations/rollback/`.

## Arquivos tocados
- `supabase/functions/_shared/voip/{caller,call-plane}.ts` + `call-plane.test.ts`
- `supabase/functions/torquecalls-signal/index.ts`
- `src/modules/communication/{hooks/useVoipSession.ts,components/voice/VoiceCallButton.tsx,components/chat/view/MobileChatThreadHeader.tsx,lib/torquecallsApi.ts}`
- `src/modules/leads/components/{lead-card/LeadCard.tsx,lead-card/LeadCardContainer.tsx,deal-card/DealCard.tsx,deal-card/DealCardPanel.tsx}`
- `supabase/tests/{voip_can_see_call_dono_canonico_test.sql,voip_foundation_test.sql,run.sh}`
- `tests/unit/ligar-em-todo-lead-visivel.test.tsx`
- `docs/adr/0024-torquecalls-voice-call-plane.md` (Emenda 1), `docs/RUNBOOK-torquecalls-ativacao.md`

## Decisões
- Dono do lead deixa de ser condição para ligar — ADR-0024 Emenda 1.
- Visibilidade é perguntada ao banco com o JWT do chamador, nunca reescrita em TypeScript.
- Cards recebem o botão por slot (grafo do `/preview.html` não pode alcançar react-query/Supabase).

## Ordem de deploy
1. Migration em prod. 2. `supabase functions deploy torquecalls-signal --project-ref jsjsmuncfkbsbzqzqhfq`. 3. Merge (front sobe sozinho).

## Follow-ups
- Master shadow: a RLS de `leads` decide se o master enxerga o lead; se não enxergar, também não liga (coerente com a tela).
- Kanban card, lista de leads e Carteira ficaram fora (não pedidos).
