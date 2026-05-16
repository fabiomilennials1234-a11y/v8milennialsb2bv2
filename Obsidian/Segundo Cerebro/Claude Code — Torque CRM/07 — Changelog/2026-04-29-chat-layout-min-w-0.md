---
type: changelog
title: Chat Onda 2b — fix layout / overflow horizontal
status: shipped
created: 2026-04-29
updated: 2026-04-29
tags: [uncategorized]
related: []
owner: gabriel
---

# Chat Onda 2b — fix layout / overflow horizontal

## Sintoma
Em alguns chats do `VITE_CHAT_ONDA_2B=true`: bolhas de mensagem cortadas à direita, documento outbound ultrapassando painel central, sensação de zoom quebrado em densidades. Composer ocasionalmente fora da área visível.

## Causa-raiz
Cadeia de containers flex (vertical e horizontal) **sem `min-w-0`** em pontos críticos. Em flexbox, filho cuja largura mínima intrínseca > espaço disponível força o container a expandir. Combinado com:
- `MessageDocument` com `min-w-[200px]` rígido.
- `MessageImage`/`MessageVideo` com `max-w-[240px]` sem `max-w-full` — em painel estreito, 240px ultrapassa bolha 75%.
- `MessageBubble` com `max-w-[75%]` mas sem `min-w-0` no flex row pai nem `overflow-hidden` na bolha.

`overflow-hidden` no `ResizablePanel` do `ChatShell` não bastava — o overflow vazava pelos painéis filhos.

## Fix
Contrato canônico estabelecido na cadeia chat:

```
ChatShell painel central
  └─ flex flex-col h-full min-h-0 min-w-0 overflow-hidden  ← +min-w-0
     └─ ChatView root  flex flex-col h-full min-h-0 min-w-0  ← +min-w-0
        ├─ ChatHeader  shrink-0 min-w-0 overflow-hidden  ← +min-w-0
        ├─ messages wrapper  flex-1 min-h-0 min-w-0 overflow-hidden  ← +min-w-0
        │  └─ MessageList  flex-1 min-h-0 min-w-0 overflow-hidden  ← +min-w-0
        │     └─ MessageBubble row  flex min-w-0 w-full
        │        └─ bubble  max-w-[75%] min-w-0 overflow-hidden  ← +min-w-0 +overflow
        │           ├─ MessageImage  max-w-full sm:max-w-[240px]
        │           ├─ MessageVideo  max-w-full sm:max-w-[240px]
        │           └─ MessageDocument  w-full max-w-full min-w-0 overflow-hidden
        └─ ChatComposer  shrink-0 min-w-0  ← +min-w-0
```

## Arquivos alterados
- `src/components/chat/layout/ChatShell.tsx` — `min-w-0` em 3 painéis + wrappers internos.
- `src/components/chat/ChatShellWithContext.tsx` — root da `ChatView` + wrapper de mensagens.
- `src/components/chat/view/ChatHeader.tsx` — `min-w-0 overflow-hidden` no root.
- `src/components/chat/view/MessageList.tsx` — wrapper relativo + `w-full` no `ScrollArea`.
- `src/components/chat/composer/ChatComposer.tsx` — `min-w-0` no root.
- `src/components/chat/WhatsAppChat.tsx` — `MessageBubble` row `min-w-0 w-full`, bolha `min-w-0 overflow-hidden`, action bars `shrink-0`, sticker `max-w-full`.
- `src/components/chat/media/MessageMedia.tsx` — Imagem/Vídeo `max-w-full sm:max-w-[240px]`. Documento sem `min-w-[200px]`, com `w-full max-w-full min-w-0 overflow-hidden`. Placeholders error/loader com `max-w-[192px]`.
- `tests/e2e/12-chat-layout.spec.ts` — novo, cobre 1365×768 + zoom 125/150% + deep-link.

## Critérios de aceite — validação
1. ✅ Desktop 1365×768 sem scroll horizontal — E2E test 1+2.
2. ✅ Header/Composer fixos, MessageList único scroll — `shrink-0` preservado.
3. ✅ Documento nome longo trunca — `truncate` existente + container `overflow-hidden`.
4. ✅ Imagem/vídeo/documento respeitam bolha — `max-w-full` adicionado.
5. ✅ Deep-link `?phone=` íntegro — não tocado, E2E test 4.
6. ✅ Densidades sem zoom quebrado — E2E test 3 (zoom 1.25/1.5).
7. ✅ tsc=0 erros, eslint=0 erros. Unit 2878 pass / 19 pre-existentes em evolution/shared-action-handler.

## Riscos residuais
- E2E `12-chat-layout` requer seed com instância WhatsApp + ao menos 1 conversa para auditoria de overflow ser significativa.
- Zoom 200%+ pode reduzir bolha a < 80px — comportamento aceitável (truncamento agressivo, mas sem corte fora de tela).
- `ChatHeader` em painel ultra-estreito (< 380px, fora do `minSize=40%`) pode esconder controles via `overflow-hidden` — desejável vs. corte fora do viewport.
