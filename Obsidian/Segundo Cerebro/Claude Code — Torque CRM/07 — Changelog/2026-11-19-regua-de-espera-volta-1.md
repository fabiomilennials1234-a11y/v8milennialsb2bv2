---
type: changelog
title: "2026-11-19 — Régua de espera (CX ①), volta 1 do revisor/qa"
status: active
created: 2026-11-19
updated: 2026-11-19
tags: [changelog, cx, regua-de-espera]
related: []
owner: claude-agent
---

# 2026-11-19 — Régua de espera (CX ①), volta 1 do revisor/qa

## Mudanças
- **Comando**: esqueleto do card "Conversas aguardando" com a mesma grade/ordem/altura do card real (cartão de foco em cima abaixo de `lg`); contagem em osso no cabeçalho. Medido no harness: Δ 3 px em 390/589/1280 px (antes 524 px no celular).
- **Espera**: área em `role="group"` + `aria-busy`, nome só pelo `rotulo` (a frase não é lida 2×); frase quebra linha.
- **WhatsApp (área frágil) — confirm**: janela `since` não corta mais no fim do item anterior quando ele deixou `message_id` (a exclusão por id cobre); sem id, corta em `fim - 1 s` (timestamp do provider tem precisão de segundo). Evita falso "não saiu" → fila interrompida → reenvio de mensagem entregue.
- **WhatsApp — mídia**: 1º `preparar()` memoizado por objeto; `onError` nunca relê o arquivo; bolha de falha guarda `preparo` e o reenvio prepara de novo.
- **WhatsApp — composers**: bolha e celular sem trava por `isPending`; desfecho único `tratarFalhaDoEnvio` (fila cheia devolve rascunho/anexo; item interrompido sem toast).
- **Ficha**: responsável troca uma vez por vez (trava até o eco do servidor) — sem conflito #307 falso na 2ª troca.
- **Telemetria**: lote de saída (`pagehide`/aba escondida) por `fetch keepalive` com token em memória, sem `await`.
- **Funil**: `TaskMoveGate` em fila (2º arrasto espera a vez em vez de voltar calado); exceção da checagem não vira unhandled rejection.
- **Chat**: esqueleto da rota segura 300 ms; painel da thread passa pela `Espera` com osso de bolhas (sem `Loader2`).

## Arquivos tocados
- `src/modules/analytics/components/dashboard/v2/CardConversasAguardando.tsx`
- `src/shared/espera/{Espera.tsx,useSegurarEsqueleto.ts,index.ts}`
- `src/modules/communication/hooks/chat/{shared/filaDeEnvio.ts,useWhatsAppSend.ts,types.ts}`
- `src/modules/communication/components/chat/composer/{tratarFalhaDoEnvio.ts,ChatComposer.tsx,MobileComposerContextual.tsx}`, `bubble/ChatBubbleComposer.tsx`, `view/MessageList.tsx`, `ChatSkeleton.tsx`, `ChatShellWithContext.tsx`
- `src/modules/leads/components/lead-detail/modal/header/ResponsibleSlot.tsx`
- `src/lib/analytics.ts`, `src/core/perf/medicao.ts`
- `src/modules/engagement/components/tasks/TaskMoveGate.tsx`, `src/modules/pipelines/components/funis/useFunilMoveFlow.tsx`

## Follow-ups
- `MessageList` (bolha flutuante) ainda mostra `Loader2` no carregamento da thread.
