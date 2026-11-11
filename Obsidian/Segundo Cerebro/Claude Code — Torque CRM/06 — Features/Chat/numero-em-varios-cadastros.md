---
type: feature
title: Número em vários cadastros — de qual lead é a conversa
status: active
created: 2026-11-09
updated: 2026-11-09
tags: [chat, whatsapp, lead, telefone, feature]
related: ["[[conversa-do-lead]]", "[[2026-11-09-numero-em-varios-cadastros]]"]
owner: claude-agent
---

# Número em vários cadastros — de qual lead é a conversa

## O que é

O mesmo telefone pode estar em 2+ leads vivos da org: principal de um (`leads.normalized_phone`) e contato de outros (`lead_phones`). Na Café Jurerê é o normal — o ERP Toth tem o mesmo cliente como PF, PJ, filiais e CNPJ duplicado. A mensagem chega pelo número; esta regra decide a qual lead ela pertence.

## Como funciona

Ordem única, idêntica em três lugares:
- trigger `public.resolve_message_lead_id` (BEFORE INSERT em `whatsapp_messages`), via `private.lead_do_numero_ambiguo`;
- borda `supabase/functions/_shared/lead-by-phone.ts` (`pickLeadForNumber`);
- front `src/modules/communication/lib/leadByPhone.ts` (espelho).

1. 1 candidato vivo → ele.
2. 2+ candidatos:
   a. escolha explícita do usuário para (org, número) em `whatsapp_numero_lead_escolhido`, se o lead ainda é candidato;
   b. negócio aberto mais recente (`deals.source_lead_id`, `closed_at` e `deleted_at` nulos);
   c. vínculo anterior: lead da mensagem vinculada mais recente do número (org, viva), se ainda é candidato;
   d. nenhum.

Sem lead, a aba Infos do painel do chat (`context-panel/SemLeadVinculado.tsx`) mostra "Este número está em N cadastros", lista nome, empresa e `erp_code`, e cada cadastro tem "Vincular esta conversa". O botão chama `escolher_lead_do_numero(org, telefone, lead)`, que grava a escolha e vincula as mensagens do número que estão sem lead (as já vinculadas não mudam) e o `lead_id` vazio do resumo do inbox.

## Regras de negócio

- A escolha vale para o número na org, em qualquer caixa, até o usuário trocar: o vínculo número↔lead é fato da org e rege as mensagens FUTURAS de todas as caixas.
- O vínculo RETROATIVO (mensagens já recebidas sem lead) fica só nas caixas que o usuário lê — mesmo recorte da policy RESTRICTIVE `whatsapp_messages_instance_read_access`: master e admin ativo da org, todas; os demais, `private.whatsapp_readable_message_instance_ids()` (mensagem sem caixa fica de fora para eles).
- Em org onde UPDATE de `lead_id` de mensagem outgoing tem efeito fora do chat (`private.vinculo_de_lead_tem_efeito_externo`: Riofix, ou pipeline ativo com `first_human_outbound_stage`), a RPC vincula só incoming.
- Escolha de lead que deixou de ter o número (apagado, contato removido) é ignorada.
- A RPC exige membro ativo da org (`assert_org_access`) que vê a conversa (`can_see_chat`, o mesmo predicado da policy de UPDATE de `whatsapp_messages`) e lead que é candidato vivo.
- Tabela da escolha: leitura por RLS (mesmo recorte de `whatsapp_messages`); escrita só pela RPC.

## Edge cases

- Caixa já removida de `whatsapp_instances`: o vínculo anterior continua valendo (caso Cliente Exemplo).
- Caixa de cobrança (`reserved_for = 'collections'`): segue sem lead.
- Front publicado antes da migration: a leitura da escolha que falha com tabela ausente (`PGRST205`/`42P01`) é ignorada; qualquer outra falha vira `error`.

## Áreas frágeis

- WhatsApp e multi-tenant: RPC `SECURITY DEFINER` com org por parâmetro, gate obrigatório.
- UPDATE de `lead_id` de outgoing dispara `trg_first_human_outbound_stage` (avança etapa em pipeline com `first_human_outbound_stage` ligado) e, na Riofix, `riofix_proposal_message_update` (enfileira workflow). Regra única em `private.vinculo_de_lead_tem_efeito_externo`, usada pela RPC (só incoming) e pelo backfill (aborta).
- No front, o vínculo anterior (2c) é lido sob RLS e pode divergir do trigger para quem não lê a caixa; o trigger é a autoridade.

## Histórico

- 2026-11-09 — criado. Corrige a regressão de 19/10 (migration 20271128000000): com o negócio fechado a conversa perdia o lead. Migration 20280102000000 (regra + RPC) e backfill avulso `supabase/ops/backfill-numero-compartilhado-vinculo-anterior.sql`.
