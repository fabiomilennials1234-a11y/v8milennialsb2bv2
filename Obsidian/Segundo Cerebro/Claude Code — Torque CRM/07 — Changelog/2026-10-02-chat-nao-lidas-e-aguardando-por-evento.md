---
type: changelog
title: "Não-lidas por evento + aguardando resposta em 1 RPC"
status: active
created: 2026-10-02
updated: 2026-10-02
tags: [changelog, chat, whatsapp, performance, incidente]
related: []
owner: claude-agent
---

# 2026-10-02 — Não-lidas por evento + "aguardando resposta" em 1 RPC

## Mudanças
- **Chat / badge de não-lidas**: `get_unread_total` (bolha, toda tela) e `get_unread_counts` (ponto por caixa no /chat) saíram do polling cego de 60 s. Atualizam por evento — realtime de `whatsapp_messages` (INSERT incoming) que o app já assina + gravação de read-state — com teto de 1 releitura a cada 20 s por aba (throttle de borda dupla), refetch no foco e fallback de 5 min. Aba escondida só marca como velho.
- **DB / `get_unread_counts`**: reescrita. A antiga perdia `organization_id` da condição de índice (o `IN (SELECT get_my_organization_ids())` virava hash join) e varria o índice parcial inteiro, de todas as orgs. A nova parte em `fresh` (conversas sem read-state: index-only scan de 7 d por org+caixa) e `seen` (uma sonda por conversa com read-state). Semântica idêntica, provada por md5 em 3 usuários reais.
- **Comando / "Clientes aguardando resposta"**: de 1 RPC por chip (57 na Alamaster, 12,4 s cada) para 1 chamada a `get_conversations_awaiting_human_reply_multi`. Janela padrão 7 d. RPC antiga intacta (expand/contract).
- **Escrita, NÃO aplicada.** Migrations com versão provisória — renumerar na hora de aplicar.

## Números (prod, read-only, usuário real)
| | antes | depois |
|---|---|---|
| unread, 57 caixas (admin Alamaster) | > 20 s (timeout) | 109–118 ms quente |
| unread, 16 caixas | ~6,7 s (14,3 s no log) | 44 ms |
| aguardando, 57 caixas | 57 × ~12,4 s | 1 × 176 ms quente (~1 s frio) |

## Arquivos tocados
- `src/modules/communication/hooks/chat/unreadRefresh.ts` — novo: throttle + `pedirAtualizacaoDeNaoLidas`.
- `src/contexts/ChatBubbleContext.tsx`, `src/modules/communication/hooks/chat/useNaoLidasPorCaixa.ts` — sem polling de 60 s.
- `src/modules/communication/hooks/chat/useWhatsAppRealtime.ts`, `useChatBubbleContactsRealtime.ts`, `components/chat/ChatShellWithContext.tsx` — gatilhos por evento.
- `src/modules/analytics/hooks/useConversasAguardando.ts` — `useQuery` único + fallback por chip só se a RPC multi faltar.
- `supabase/migrations/20271103100000_unread_counts_por_conversa.sql`, `20271103100001_aguardando_resposta_multi_caixa.sql`.

## Decisões
- RPC multi usa `is_org_admin(p_org)` no bypass do isolamento, não `is_user_admin()` (org-agnóstica) — só estreita; mesma correção da `get_whatsapp_conversation_list_multi`.
- EXECUTE da multi só para `authenticated` (revogado de PUBLIC, anon, service_role).

## Follow-ups
- `get_conversations_awaiting_human_reply` (por chip) tem EXECUTE para `anon` em prod — gate interno recusa, mas é superfície. Revogar quando aposentar.
- Aposentar a RPC por chip depois que o front novo assentar.
