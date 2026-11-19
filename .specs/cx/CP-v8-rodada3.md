# CP-v8 — rodada 3: revisor APROVA; qa FALHA com 2 furos novos. CTO autorizou volta 3 CURTA (19/11), só estes 2 pontos.

## F3-b (bloqueante) — gravações fora de ordem na mesma entrada
`src/modules/pipelines/lib/optimistic-move.ts:292-306` + `concluirMovePipelineEntry`: move mais novo concluído sai da lista de abertos; quando o antigo é revertido depois, `rollbackPipelineEntryMove` não acha move seguinte e aplica inversa completa.
Repro Funil V5: e-1 aberto→proposta (escrita lenta); durante ela e-1→negociacao; 2ª escrita OK primeiro; depois 1ª falha (timeout). Esperado e-1 em negociacao, contagens {aberto:1, negociacao:1}. Observado: aberto [e-1,e-2], negociacao [], cnt {aberto:2, proposta:0, negociacao:1} (soma 3 p/ 2 cards). Legado (B✓ depois A✗): novo [a,b,c], proposta [], cnt {novo:3, proposta:1}. Gate serializa só checagens, não escritas (2 moverAsync em voo). Alcance: useFunilMoveFlow.tsx:345-358, usePipeWhatsapp.ts:221-225.
Fix sugerido: quando move mais novo da mesma entrada concluir, marcar anteriores ainda abertos como SUPERADOS; reversão de superado = no-op em posição e contagem (no máx. aviso).
Repros: scratchpad/qa-r3-testes/qa-r3-f3.test.tsx, qa-r3-legado.test.ts (matriz exaustiva 48 combinações).

## F2-b — texto confirmado com linha de mídia
`useWhatsAppSend.ts` recoveryContext: confirm de texto filtra só `content` (`else q = q.eq("content", …)`) e não exclui mídia; webhook grava legenda em `content` (whatsapp-webhook/handler.ts:550, meta-webhook/index.ts:928). Mídia sem dono tem assinatura de mídia (não entra na contagem de sem-dono do texto), mas a linha dela serve de prova p/ texto. Repro: imagem legenda "ok" 504 com webhook atrasado → bolha de falha; texto "ok" 504 NÃO entregue; relógio do cliente 2 min atrás → texto CONFIRMADO com message_id da imagem. Variante: mídia 200 sem id + texto "ok" 504 (sem diferença de relógio; nenhum provedor atual devolve 200 sem id).
Fix: `.is("media_url", null)` na consulta de texto (e simétrico: confirm de mídia já filtra media_url — confirmar). Repro: scratchpad/qa-r3-testes/qa-r3-f2.test.tsx (QA_CASOS=1500; QA_SEM_ID_MIDIA=1 mostra 5 violações).

## Revisor rodada 3 — não bloqueante que vale corrigir junto (curto)
NB-1 `useBulkActions.ts:68` + `BulkActionBar.tsx:271,349`: 2º clique vira 2ª mutação que falha na hora → isPending cai, spinner some, botão reabilita enquanto o 1º lote corre, toast "Já há uma movimentação em andamento". Ação: trava síncrona no handleSubmit com retorno silencioso; a de mutationFn fica como rede.

## Fora (anotado, não fazer agora)
Memória não podada (Map de escopos, foraPorCliente); prazo 10 s no lote; lacuna de teste do onMutate próprio do usePaginatedFunil; dedup de bolha por texto (herdado); id falso ev_ do Evolution; relógio atrasado + histórico em memória (resíduo declarado).
