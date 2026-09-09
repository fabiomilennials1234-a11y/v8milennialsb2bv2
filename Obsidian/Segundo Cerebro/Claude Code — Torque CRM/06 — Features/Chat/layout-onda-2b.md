---
type: feature
title: Chat Onda 2b — contrato de layout
status: active
created: 2026-04-12
updated: 2026-09-03
tags: [uncategorized]
related: []
owner: gabriel
---

# Chat Onda 2b — contrato de layout

## Resumo
Layout 3-col resizable do chat novo (`ChatShellWithContext`), ativado por `VITE_CHAT_ONDA_2B=true`. Painéis: lista (20–35%) | chat (≥40%) | contexto (23–42%, colapsável).

## Contrato `min-w-0` (não quebrar)

Cadeia obrigatória:

| Componente | Classes obrigatórias |
|------------|----------------------|
| `ResizablePanel` (3 painéis) | `flex flex-col min-h-0 min-w-0 overflow-hidden` |
| Wrapper interno de cada painel | `flex flex-col h-full min-h-0 min-w-0 overflow-hidden` |
| `ChatView` root | `flex flex-col h-full min-h-0 min-w-0` |
| `ChatHeader` root | `flex items-center ... shrink-0 min-w-0` (sem `overflow-hidden` desde 2026-09-03) |
| `ChatHeader` contato | `flex-1 min-w-[11rem]` — único bloco que encolhe, com piso; linha do nome `flex-nowrap`, `h3` truncado, badges `shrink-0` |
| `ChatHeader` ações | `flex items-center gap-1.5 shrink-0` — Ligar ▾ · Ver lead · histórico; rótulos `hidden lg:inline`; densidade `hidden lg:flex` + "⋯" entre `md` e `lg` |
| Wrapper de mensagens | `flex-1 min-h-0 min-w-0 overflow-hidden` |
| `MessageList` raiz | `flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col relative` |
| `MessageBubble` row (motion.div) | `flex gap-2 group min-w-0 w-full` + justify |
| `MessageBubble` bolha | `max-w-[75%] min-w-0 px-4 py-2.5 overflow-hidden` |
| `ChatComposer` root | `... shrink-0 min-w-0` |

## Mídia dentro da bolha

| Tipo | Largura |
|------|---------|
| Imagem (`MessageImage`) | `max-w-full sm:max-w-[240px] max-h-[300px]` |
| Vídeo (`MessageVideo`) | `max-w-full sm:max-w-[240px] max-h-[300px]` |
| Documento (`MessageDocument`) | `w-full max-w-full min-w-0 overflow-hidden` (sem `min-w` rígido) |
| Sticker | `w-32 h-32 max-w-full` |
| Loader/error placeholder | `w-full max-w-[192px] h-32` |

## Por quê
Em flexbox, filho cuja largura mínima intrínseca > espaço disponível força o container a expandir. Sem `min-w-0`, conteúdo intrínseco grande (documento com nome longo, mídia 240px) vaza pelo painel resizable mesmo com `overflow-hidden` no shell.

## Edge cases conhecidos
- Painel central no `minSize=40%` em viewport 1280px = ~512px → bolha 75% ≈ 384px. Mídia 240px cabe folgada. OK.
- Zoom 150%: viewport efetivo cai para ~910px → cadeia `min-w-0` impede vazamento.
- Densidade `compact` (CSS vars reduzem padding): truncamento mais agressivo, mas sem corte.

## Histórico
- 2026-04-29 — fix layout overflow horizontal ([changelog](../../07%20—%20Changelog/2026-04-29-chat-layout-min-w-0.md)).

## Cabeçalho — quem cede espaço (2026-09-03)

O cabeçalho é uma linha só, com sete controles `shrink-0` e um bloco que encolhe: o contato. Com dois
números de voz o botão de ligar chegou a 200 px e o contato colapsou até sobrar o avatar (print do CTO,
Milennials). Regra vigente: o contato tem piso (`min-w-[11rem]`) e trunca em vez de quebrar linha; as
ações moram num grupo `shrink-0`; abaixo de `lg` os rótulos "Ligar" e "Ver lead" viram ícone com tooltip
e a densidade entra num menu "⋯"; o nome do número de voz vive no tooltip do botão ("Ligar por X") e no
menu, nunca no cabeçalho. Sem `overflow-hidden` na raiz. Contrato preso em `ChatHeader.test.tsx`.
Detalhe: [[2026-09-03-chat-cabecalho-ligar-layout]].
