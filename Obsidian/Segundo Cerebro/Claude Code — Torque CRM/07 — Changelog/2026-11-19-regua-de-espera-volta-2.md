---
type: changelog
title: "2026-11-19 — Régua de espera (CX ①), volta 2 do revisor/qa"
status: active
created: 2026-11-19
updated: 2026-11-19
tags: [changelog, cx, regua-de-espera]
related: []
owner: claude-agent
---

# 2026-11-19 — Régua de espera (CX ①), volta 2 do revisor/qa

## Mudanças
- **WhatsApp (área frágil) — confirm sem falso positivo**: o confirm de envio ambíguo (timeout/5xx) passou a CONTAR. A fila lembra, por conversa, cada item que chamou o provider (assinatura = citação + mídia ou texto, `_sendId`, linha atribuída ou não). O item N só é dado como enviado quando a janela (`ts - 1 s`) tem, fora das linhas já atribuídas, MAIS linhas de mesma assinatura do que itens anteriores "sem dono" (chamaram o provider e não ficaram com linha). Na dúvida não confirma: bolha de falha + reenvio manual. Reenvio da mesma mensagem (mesmo `_sendId`) não conta o original contra si. Sem corte de tempo pelo fim do item anterior (timestamp truncado deixa de importar).
- **Funil — otimismo sobreposto**: rollback do move otimista é a INVERSA por entrada (tira o card de onde estiver, devolve à origem na posição original, contagens ±1), não a restauração do snapshot inteiro. Moves abertos ao mesmo tempo (checagem de tarefa em fila) não se desfazem um ao outro. Mesma entrada movida 2× com as duas checagens abertas: cancelar o 1º não mexe; o 2º herda a origem do 1º. Posição original calculada contra os cards ainda fora da coluna (reverter em qualquer ordem devolve a ordem certa).
- **TaskMoveGate**: cada ida ao servidor da checagem tem prazo de 10 s → recusa com aviso ("demorou demais") e a fila anda. O modal de pendências não expira.
- **Duplo disparo com a checagem em fila**: `DealCardPanel.definirDesfecho` trava (ref + `decidindo`) ANTES do `requestTaskMove`; `useCrossPipeMove.move` e `useBulkMoveToPipeline` ganharam trava síncrona equivalente.
- **Ficha — responsável**: a trava "aguardando eco" solta no erro do refetch do `lead-detail` e após 8 s; eco que chega antes da gravação responder não trava.
- **Celular — template com mídia**: o "/comando" volta ao campo só na fila cheia (falha real já tem bolha de reenvio).

## Arquivos tocados
- `src/modules/communication/hooks/chat/shared/filaDeEnvio.ts` — `assinaturaDoEnvio`, `registrarTentativa`, `provaDeConfirmacao`, histórico por fila (horizonte 10 min, teto 50 ids excluídos).
- `src/modules/communication/hooks/chat/useWhatsAppSend.ts` — `recoveryContext` usa a prova (limit = mínimo de linhas).
- `src/modules/pipelines/lib/optimistic-move.ts` — snapshot por entrada, inversa, `concluirMovePipelineEntry`.
- `src/modules/pipelines/lib/funil-move-cache.ts` — `reverterMoveOtimista` (inversa), `concluirMoveOtimista`.
- `src/modules/pipelines/components/funis/useFunilMoveFlow.tsx`, `hooks/model/usePaginatedFunil.ts`, `hooks/legacy/usePipeWhatsapp.ts` — concluem o move gravado.
- `src/modules/engagement/components/tasks/TaskMoveGate.tsx` — prazo.
- `src/modules/leads/components/deal-card/DealCardPanel.tsx`, `lead-detail/modal/pipes/useCrossPipeMove.ts`, `hooks/useBulkActions.ts` — travas.
- `src/modules/leads/components/lead-detail/modal/header/ResponsibleSlot.tsx` — saída da trava do eco.
- `src/modules/communication/components/chat/composer/MobileComposerContextual.tsx` — "/comando" só na fila cheia.

## Testes
- `tests/unit/chat-fila-confirm-sem-falso-positivo.test.tsx` (repro do qa, reenvio, "ok"×3 em 64 combinações × 2 modos, regra pura).
- `tests/unit/funil-otimismo-sobreposto.test.tsx` (repro do qa, mesma entrada 2×, matriz 2–3 cards × cancelar/confirmar/erro × mesma/outra coluna).
- `tests/unit/ficha-responsavel-eco.test.tsx`, `tests/unit/deal-card-desfecho-duplo-clique.test.tsx`; acréscimos em `funil-task-gate-fila`, `mobile-composer-contextual`, `chat-fila-de-envio`.

## Follow-ups
- Envio idêntico por OUTRA aba/automação na mesma conversa e janela continua indistinguível sem id do provider (resíduo conhecido, já existia).
