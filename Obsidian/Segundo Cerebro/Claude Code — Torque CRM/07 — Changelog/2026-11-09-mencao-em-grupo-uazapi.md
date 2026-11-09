---
type: changelog
title: Menção (@) ao enviar para grupo do WhatsApp (Uazapi)
status: active
created: 2026-11-09
updated: 2026-11-09
tags: [changelog, chat, whatsapp, uazapi]
related: []
owner: claude-agent
---

# 2026-11-09 — Menção (@) ao enviar para grupo do WhatsApp (Uazapi)

## Mudanças
- **Composer (grupo Uazapi)**: digitar `@` abre um seletor com "Todos" e os participantes do grupo (nome + número). ↑↓ navegam, Enter/Tab escolhem, Esc fecha. "Todos" insere `@todos`; participante insere `@<número>`. Vale no texto e na legenda de mídia.
- **Envio**: a lista `mentions` sai do TEXTO FINAL — só `@<número>` que continua no texto e é de participante conhecido. Sem menção, o payload é idêntico ao de antes. `@todos`/`@all` a Uazapi resolve sozinha.
- **Proxy**: `sendText`/`sendMedia` aceitam `mentions`, sanitizado (`_shared/group-mentions.ts`): só destino de grupo válido, item numérico de 8–20 dígitos ou `all`, sem repetição, teto 50. Inválido é descartado sem erro.
- **Proxy**: ação nova `groupParticipants { groupjid }` → `POST /group/info`. Passa pela fronteira de org e pelo gate de conversa (`can_see_chat_target`, alvo = o `groupjid`). Só Uazapi (demais → 400 `group_participants_not_supported`). Resposta enxuta: `phone`, `lid`, `name`, `isAdmin`.
- **Contrato Uazapi**: `mentions` passou de `string[]` para `string` (vírgula), como no spec.
- **Circuit breaker**: `/group/*` ganhou grupo próprio — leitura de grupo falhando não bloqueia o envio.

## Arquivos tocados
- `supabase/functions/_shared/group-mentions.ts` — sanitização e normalização de participantes
- `supabase/functions/_shared/uazapi-types.ts`, `uazapi-client.ts`, `whatsapp-client.ts`, `whatsapp-providers/uazapi-provider.ts` — contrato, `groupInfo`, repasse de `mentions`
- `supabase/functions/_shared/chat-owner-guard.ts` — `groupParticipants` no gate (alvo só o `groupjid`)
- `supabase/functions/whatsapp-api-proxy/index.ts` — `mentions` e ação nova
- `src/modules/communication/lib/groupMentionComposer.ts`, `hooks/chat/useGroupParticipants.ts`, `hooks/chat/useMentionAutocomplete.ts`, `components/chat/composer/MentionPopover.tsx`, `ChatComposer.tsx`, `hooks/chat/useWhatsAppSend.ts`, `lib/whatsappApi.ts`
- Testes: `tests/unit/uazapi-group-mentions.test.ts`, `whatsapp-api-proxy-group-mentions.test.ts`, `group-mention-composer.test.tsx`, `chat-composer-group-mentions.test.tsx`

## Decisões
- Participante só-LID não aparece no seletor: a Uazapi documenta menção por número; LID não foi verificado.
- Participantes só são buscados depois do primeiro `@` digitado na tela (cache 5 min por instância + grupo).

## Follow-ups
- A bolha da própria mensagem enviada mostra `@número` (o nome não é resolvido no nosso chat).
- Composer mobile e o da bolha flutuante ainda não têm o seletor.
- Confirmar em grupo real se a Uazapi aceita LID em `mentions`.
