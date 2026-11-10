---
type: changelog
title: Número em vários cadastros volta a vincular a conversa
status: active
created: 2026-11-09
updated: 2026-11-09
tags: [changelog, chat, whatsapp, lead]
related: ["[[numero-em-varios-cadastros]]"]
owner: claude-agent
---

# 2026-11-09 — Número em vários cadastros volta a vincular a conversa

## Mudanças
- **Resolução de lead por número**: com 2+ cadastros, a ordem passa a ser escolha explícita > negócio aberto > vínculo anterior > nenhum. Igual no trigger, na borda e no front.
- **Chat**: conversa sem lead de número em 2+ cadastros lista os cadastros (nome, empresa, código do ERP) com "Vincular esta conversa".
- **Banco**: tabela `whatsapp_numero_lead_escolhido`, RPC `escolher_lead_do_numero`, `resolve_message_lead_id` reescrita.
- **Backfill** (avulso em `supabase/ops/`, roda depois da migration): 1.096 mensagens em 58 conversas da Café Jurerê herdam o lead da mensagem vinculada anterior.

## Arquivos tocados
- `supabase/migrations/20280102000000_numero_compartilhado_escolha_e_vinculo_anterior.sql` + rollback — tabela, RPC, trigger
- `supabase/ops/backfill-numero-compartilhado-vinculo-anterior.sql` + rollback — backfill com trilha em `private`
- `supabase/functions/_shared/lead-by-phone.ts`, `src/modules/communication/lib/leadByPhone.ts` — `pickLeadForNumber`
- `src/modules/communication/hooks/useCadastrosDoNumero.ts`, `context-panel/SemLeadVinculado.tsx`, `ContextPanelTabInfo.tsx` — UI
- `tests/integration/numero-compartilhado-escolha.test.mjs` (PGlite), `tests/unit/lead-by-phone.test.ts`, `context-panel/__tests__/SemLeadVinculado.test.tsx`

## Decisões
- A RPC usa `can_see_chat` como gate além de `assert_org_access`: só revincula quem já poderia editar a conversa pela policy de UPDATE.
- A escolha vale para a org (mensagens futuras de todas as caixas); o vínculo retroativo fica só nas caixas que o usuário lê. Em org com efeito externo no UPDATE de `lead_id` (Riofix, `first_human_outbound_stage`), só incoming.
- Vínculo anterior em SQL salta por caixa no índice `idx_whatsapp_msgs_org_phone_instance_ts`, sem índice novo na tabela de 7 GB.
- `useLeadByPhone` mantém a forma do cache (`lead_by_phone`): as atualizações otimistas de `useLeads` dependem dela. Os candidatos têm query própria.

## Follow-ups
- Aplicar em prod (humano): a migration 20280102000000 e, depois, o backfill avulso.
- Trocar o cadastro depois de vinculado (mensagens já vinculadas não mudam).
- Dedupe de cadastros com CNPJ repetido no ERP (fora de escopo).
