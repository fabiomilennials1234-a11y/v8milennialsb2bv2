---
type: changelog
title: Chat — política de reconciliação (polling que não acelera sob carga)
status: active
created: 2026-10-05
updated: 2026-10-05
tags: [changelog, chat, whatsapp, realtime, incidente, performance]
related: ["[[2026-10-02-chat-nao-lidas-e-aguardando-por-evento]]"]
owner: claude-agent
---

# 2026-10-05 — Chat: política de reconciliação

## Mudanças
- **Chat / polling**: thread e lista deixaram de pollar a 10 s (realtime doente) / 20 s (saudável). Agora: saudável thread 120 s, lista 300 s; em fallback, degraus por tempo desde a entrada — thread 30→60→120 s, lista 60→120→300 s. Jitter determinístico só aditivo (0..+25%). Nunca < 10 s.
- **Inbox do /chat** (`useConversasUnificadas` → `queryChips`): ganhou rede de segurança (antes não tinha nenhuma — conversa nova com evento dropado só no F5). ≤ 375 s.
- **Bug "errored"**: `useRealtimeChannel` gravava `"errored"` no store, fora do union e fora de `NON_HEALTHY_STATES` → canal com erro nunca entrava em fallback. Agora "não saudável" = tudo que não é `"joined"`.
- **Reconexão reconcilia**: store ganhou `joinCount` (sobe em todo "joined", inclusive repetido). Rejoin → invalida `whatsapp_messages`/`whatsapp_contacts` da org, throttle 15 s por aba, `cancelRefetch: false`. 1º join não reconcilia.
- **Contato fora do cache** (Fase B): o invalidate por evento passou pelo mesmo throttle — rajada colapsa em ≤ 2 refetches.
- **Foco**: as três queries com `refetchOnWindowFocus: true` + `staleTime` 30 s.
- **Tick de 5 s removido**: `useWhatsAppRealtimeFallback` re-renderizava todo consumidor a cada 5 s mesmo saudável.

## Por quê
- OOM em prod 2026-10-05 (Small → Medium). Polling que acelera quando o realtime cai é carga positiva no pior momento. Medido 05/10 11–12 Z: `whatsapp_thread_manifest` 711/h, `get_whatsapp_conversation_list_multi` 519/h — ≈1–2% das requisições; não é o driver principal do OOM.

## Arquivos tocados
- `src/modules/communication/hooks/chat/reconcilePolicy.ts` (novo) — `intervaloDeReconciliacao`, `misturarSemente`, pisos/tetos.
- `src/modules/communication/hooks/chat/chatReconcile.ts` (novo) — throttle por QueryClient (reusa `criarThrottle` de `unreadRefresh.ts`).
- `src/modules/communication/hooks/chat/useRealtimeFallback.ts` — `useReconcileInterval`, `shouldFallback` corrigido, sem tick.
- `src/lib/realtimeStatusStore.ts` — `"errored"` no union, `joinCount`, `unhealthySince`.
- `src/modules/communication/hooks/chat/useWhatsAppRealtime.ts` — assina `joinCount`; Fase B.
- `useWhatsAppMessages.ts`, `useWhatsAppContacts.ts`, `useConversasUnificadas.ts` — plugados.
- `RealtimeStatusBadge.tsx` — caso `errored`; tooltip não promete mais "a cada 10s".

## Decisões
- Degrau por TEMPO, não por nº de falhas (o breaker abre na 5ª e estaciona).
- Jitter por semente fixa da aba + `dataUpdatedAt`: TanStack v5 reinicia o timer quando o valor de `refetchInterval` muda; `Math.random()` por render faria o poll nunca disparar.
- `unhealthySince` em vez de `lastTransitionAt` para o relógio dos degraus: o backoff alterna errored ↔ joining e reiniciaria a escada a cada tentativa.

## Follow-ups
- Invalidação por envio (`useWhatsAppSend.ts:400/641`) e flapping de status entre os dois montadores.
- `queryOficiais`/sociais sem backstop (`channel_messages`).
- Broadcast (P1).
- Em fallback, mensagem nova leva 30–120 s (antes 10 s) — trade-off pedido.
