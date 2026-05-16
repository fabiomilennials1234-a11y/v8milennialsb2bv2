---
type: changelog
title: 2026-04-28 — Fix deep-link funil → chat (instância correta)
status: shipped
created: 2026-04-28
updated: 2026-04-28
tags: [uncategorized]
related: []
owner: gabriel
---



# 2026-04-28 — Fix deep-link funil → chat (instância correta)

## Problema

Cliente (Hellayne, basic4u) reportou que clicar em lead no funil abria o chat
mas conectava na instância da Bruna, sem abrir a conversa. Atrapalha primeiro
contato.

## Causa-raiz

Regressão da nova UI ativada por `VITE_CHAT_ONDA_2B=true`. O componente
`ChatShellWithContext` não lia `?phone=` da URL e auto-selecionava a primeira
instância conectada/disponível. Funil dispara `useOpenWhatsAppChat()` que
navega para `/chat-whatsapp?phone=...`, mas o chat ignorava o param.

## Correção

Resolver de deep-link cirúrgico no `ChatShellWithContext`:

1. Lê `?phone=` e `?instance=` uma vez no mount (ref).
2. Se `?instance=` está na lista permitida (`useWhatsAppInstancesForUser`),
   usa direto. Se inválida/não permitida, ignora — nunca cross-tenant.
3. Senão, novo hook `useResolveChatDeepLink` busca em `whatsapp_messages` a
   instância (entre as permitidas) onde existe conversa para o phone alvo.
   Comparação por phone normalizado (`src/lib/normalizePhone.ts`).
4. Quando contatos carregam, casa o phone alvo pelo normalizado e seta
   `selectedPhone` com o `phone_number` canônico do contato.
5. Auto-select da primeira instância só roda se NÃO houver deep-link
   pendente — não sobrescreve resolução.
6. Se nenhuma instância permitida tem conversa: toast informativo, sem
   selecionar instância errada.
7. Limpa query params depois de processar.

## Arquivos alterados

- `src/components/chat/ChatShellWithContext.tsx` — integração deep-link.
- `src/hooks/chat/useResolveChatDeepLink.ts` — hook novo (resolver server-side).
- `src/lib/whatsapp.ts` — `useOpenWhatsAppChat` aceita `instanceId` opcional.

## Segurança / multi-tenancy

- Resolver filtra por `organization_id` do team_member atual.
- Restringe `instance_id` à lista de `useWhatsAppInstancesForUser` (que já
  aplica `whatsapp_instance_allowed_members`).
- Defesa em profundidade: mesmo que a query retorne instância fora do
  permitido, é descartada client-side.
- `?instance=` da URL nunca força acesso fora da lista permitida.

## Verificação

- `npx eslint` nos arquivos alterados → exit 0.
- `npx tsc --noEmit` → sem erros nos arquivos alterados.

## Riscos residuais

- Resolver usa `phone_number LIKE '%<últimos 8>%'` em `whatsapp_messages`.
  Index existente `idx_whatsapp_messages_normalized_phone` não cobre LIKE
  parcial, mas o filtro por `organization_id + instance_id IN` reduz set
  drasticamente. Se virar gargalo, trocar por `normalized_phone` (coluna
  já existe via migration `20260908200000`, mas faltam tipos gerados —
  precisaria regenerar `types.ts`).
- Se o lead não tem nenhuma mensagem ainda (lead novo, primeiro contato),
  resolver não acha conversa e mostra toast. UX aceitável: usuário escolhe
  instância manualmente. Iteração futura: criar conversa lazy.

## Sem regressão

- Comportamento sem query param mantido (auto-select primeira conectada).
- `WhatsAppChat` legacy (sem flag) intocado.
