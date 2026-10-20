---
type: changelog
title: Canal oficial — chave canônica do contato (nono dígito) une a conversa partida
status: in-progress
created: 2026-10-20
updated: 2026-10-20
tags: [changelog, whatsapp, notificame, chat, supabase, bug]
related: []
owner: claude-agent
---

# 2026-10-20 — Canal oficial: chave canônica do contato de WhatsApp

Contexto: a caixa do canal oficial (NotificaMe) agrupa por
`channel_messages.(instance_id, contact_external_id)`. O envio gravava o telefone
do lead com o nono dígito (`5591999990000`); a Meta entrega a resposta de números
antigos sem ele (`559199990000`). Mesma pessoa, duas conversas. Medido em prod:
247 contatos, 1.276 mensagens, 100% NotificaMe; 248 chaves de leitura
(`conversation_read_state`, namespace `whatsapp_oficial:`), 9 colidindo.

## Mudanças
- **Regra única** `canonicalBrWhatsappId` em `supabase/functions/_shared/br-whatsapp-contact-id.ts`: só dígitos; 12 dígitos `55` + DDD + assinante começando em 6–9 → insere `9` após o DDD. Fixo (2–5), 13 dígitos e não-BR intactos. Mesmo critério do front (`formatPhoneForWhatsApp`). NÃO é `normalize_br_mobile` (põe 9 em fixo).
- **Escritores**: `buildOutboundChannelMessageRow` e `buildInboundChannelMessageRow` gravam `contact_external_id`/`phone_number` canônicos quando o canal é WhatsApp; Instagram fica cru. `notificame-webhook` usa a chave canônica no lookup de `lead_social_identities` e na linha; `sender_id` mantém o `wa_id` cru da Meta.
- **Destinatário enviado à Meta não muda** (continua só dígitos do que o compositor/automação mandou); a Meta aceita 13 dígitos para esses números.
- **Backfill** `20271208000000_chave_canonica_whatsapp_oficial.sql` (provisório, não aplicado): função gêmea `public.canonical_br_whatsapp_id` (IMMUTABLE, `search_path=''`, sem EXECUTE para anon/authenticated/service_role); reescreve `channel_messages` só de instâncias `provider='notificame'` com guarda de valor que muda; funde colisões de `conversation_read_state` (fica a leitura mais recente) e renomeia o resto; DO final falha se sobrar chave não canônica. Aplicar DEPOIS do deploy das edge functions.

## Arquivos tocados
- `supabase/functions/_shared/br-whatsapp-contact-id.ts` — novo, regra pura
- `supabase/functions/_shared/whatsapp-providers/notificame-provider.ts` — builder outbound
- `supabase/functions/_shared/notificame-inbound.ts` — builder inbound
- `supabase/functions/notificame-webhook/index.ts` — `contactKey`
- `supabase/migrations/20271208000000_chave_canonica_whatsapp_oficial.sql` + rollback
- `tests/unit/br-whatsapp-contact-id.test.ts` — regra, dois escritores, Instagram, paridade TS×SQL (PGlite)
- `tests/unit/notificame-webhook-handler.test.ts` — chave canônica pela requisição

## Follow-ups
- `lead_id` nulo nas linhas de inbound/outbound do canal oficial (inbound não vincula lead por telefone) — fora de escopo.
- `normalize_brazilian_phone`/`normalize_br_mobile` põem 9 em fixo — débito do banco, não tocado.
- Rascunho do compositor (localStorage, chave `chat-draft-<user>-<conversation_key>`) de conversas com chave antiga não migra.
