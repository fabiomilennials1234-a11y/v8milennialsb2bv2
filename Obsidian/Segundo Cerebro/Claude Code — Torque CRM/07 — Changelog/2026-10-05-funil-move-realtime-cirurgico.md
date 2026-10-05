---
type: changelog
title: Move no /funil — realtime cirúrgico, uma invalidação, otimismo
status: active
created: 2026-10-05
updated: 2026-10-05
tags: [changelog, pipelines, performance, realtime]
related: []
owner: claude-agent
---

# 2026-10-05 — Move no /funil: realtime cirúrgico, uma invalidação, otimismo

## Mudanças
- **Funil / Realtime**: `usePaginatedFunil` troca `useRealtimeSubscription` (invalidava o prefixo `["pipeline-page"]` inteiro a cada evento da org) por `useFunilRealtime`: cada evento invalida só as colunas que toca NESTE funil + a contagem dele, em lotes de janela fixa de 1 s. Eco do próprio move ignorado.
- **Funil / Move**: `useMoverCardNoFunil` faz otimismo (card muda de coluna na hora), rollback no erro e UMA reconciliação (colunas origem/destino + contagem do funil; outras telas só marcadas como velhas, `refetchType: "none"`). O caminho custom chama `executarMoveCustom` em vez de `useMoveLeadInCustomPipe` (que mantém a invalidação ampla para os outros consumidores).
- **Funil / Fluxos ricos**: `completarMove` aplica o otimismo antes do metadata de perda/venda e é dono do rollback; `invalidateAfterMove` saiu do fluxo do `/funil` (compareceu, agendar, auto-transição) em favor de `reconciliarMoveNoFunil`.
- **Contagens**: board e cabeçalho (`useFunilMetrics`) compartilham chave canônica — sem filtro no quadro, a RPC `get_pipeline_stage_counts_by_id` roda uma vez no mount (eram duas).
- **Analytics**: `track()` lê o usuário de `getSession()` (cache), não `getUser()` (ida a `/auth/v1/user` por evento). Payload igual.

## Por quê
- Prod 2026-10-05: um move = ~70 `get_pipeline_page` + 5 contagens em 6 s por pessoa com o board aberto; `get_pipeline_page` = 3.334 s/h de banco no pico.

## Números medidos pelo QA (main → branch, board de 14 colunas)
Formato: chamadas `get_pipeline_page` + chamadas de contagem.

| Cenário | main | branch |
|---|---|---|
| Move simples (system) | 14+1 (+14+1 do eco) | 2+1, eco 0 |
| Move simples (custom) | 28+2 (+14+1 do eco) | 2+1, eco 0 |
| Mount — contagens | 2 | 1 |
| Rajada de 11 eventos de outra pessoa | 14+1 | 8 colunas + 1 |
| Evento de outro funil | 14+1 | 0 |
| Perda / venda | 16+2 | 2+1 |
| Agendar reunião | 24+3 | ≤ 4+2 |
| Reagendar | 18+2 | 10+2 |

## Correções da revisão (volta 1)
- **R1 — eco próprio**: o eco agora é uma lista por card, consumida quando o evento casa (etapa de destino); evento do mesmo card que não casa descarta a lista e é processado. Antes um eco atrasado podia engolir um move legítimo de outra pessoa. Controle positivo: sem o consumo, os harnesses do QA ficam vermelhos.
- **R3 — eco do metadata (perda/venda)**: o UPDATE de metadata na etapa de origem também é registrado como eco (TTL 5 s); o rollback apaga a lista. Perda/venda caiu de 16+2 para 2+1.
- **R4/R5**: move negado não deixa otimismo pendurado; identidade do card preservada por spread.

## Corrigido de quebra
- Cabeçalho deixa de ficar mais velho que o board (contagens compartilhadas).
- Painéis do lead buscam dado novo depois do move (marcados como velhos, `refetchType: "none"`, recarregam ao abrir).

## Arquivos tocados
- `src/modules/pipelines/lib/funil-move-cache.ts` (novo) — otimismo, reconciliação, eco, plano do realtime.
- `src/modules/pipelines/hooks/model/useFunilRealtime.ts` (novo) — canal por org, recorte por funil no handler.
- `src/modules/pipelines/lib/stage-counts-query.ts` (novo) — chave canônica + busca das contagens.
- `src/modules/pipelines/hooks/model/usePaginatedFunil.ts`, `components/funis/useFunilMoveFlow.tsx`, `hooks/config/useFunilMetrics.ts`, `hooks/custom/useCustomPipelines.ts`, `lib/optimistic-move.ts`, `hooks/legacy/usePipeWhatsapp.ts`, `src/lib/analytics.ts`.

## Decisões
- Canal filtrado por `organization_id`, não `pipeline_id`: o Realtime avalia filtro de UPDATE na linha NOVA, então um card que sai do funil nunca chegaria a um canal filtrado pelo funil de origem.
- Coluna de origem vem do cache, não de `payload.old`: com RLS o `old` traz só a PK.

## Riscos e limites conhecidos (não são regressão)
- Sem reconciliação ao reconectar o realtime (herdado, `useRealtimeChannel`).
- `funil-desfecho-counts` não é invalidado no move (herdado, `useFunilMetrics`).
- DELETE não é entregue a canal filtrado (limitação do Supabase Realtime).
- Risco residual aceito: eco de metadata perdido + card volta à origem em < 5 s ⇒ esse evento é engolido (dentro do limite herdado de reconnect).

## Validação pós-deploy
- Abrir um funil, mover cards (simples, perda, venda, reunião), mover em outra aba/usuário.
- `query_logs`: meta move próprio ≤ 2 `get_pipeline_page` + 1 contagem.

## Follow-ups
- Move custom faz 3 idas sequenciais (etapa, escrita, releitura) — juntar exige RPC nova.
- Reconciliação no reconnect do realtime.
- Invalidar `funil-desfecho-counts` no move.
- R2 (nit): comentário de `funil-move-cache.ts` sobre o plano do realtime.
- `usePaginatedPipeline` (legado) tem o mesmo realtime por prefixo, mas sem consumidor vivo (só o próprio teste): sai na W6.
