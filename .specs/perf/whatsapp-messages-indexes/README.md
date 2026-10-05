# whatsapp_messages — HOT e índices (protocolo de 7 dias)

Origem: OOM de prod em 2026-10-05. `whatsapp_messages` = heap 1.921 MB + toast 1.149 MB + 21 índices 2.972 MB.

## Parte 1 — entregue (migrations, NÃO aplicadas)

| Arquivo | O quê | Reversão |
|---|---|---|
| `supabase/migrations/20271107140003_whatsapp_messages_fillfactor_toast_target.sql` | `fillfactor=85, toast_tuple_target=1024` | `rollback/` mesmo nome (`RESET`) |
| `supabase/migrations/20271107140004_drop_idx_whatsapp_messages_org.sql` | `DROP INDEX CONCURRENTLY` (39 MB, 0 scans) | `rollback/` mesmo nome |
| `supabase/migrations/20271107140005_drop_idx_whatsapp_conversations_instance.sql` | `DROP INDEX CONCURRENTLY` (prefixo do UNIQUE) | `rollback/` mesmo nome |

Versões provisórias: renumerar contra o ledger na hora de aplicar. Aplicar por psql autocommit no pooler session (5432) com `SET lock_timeout='3s'`; nunca `apply_migration` nem `db push` (os DROP CONCURRENTLY falham em transação). Registrar as versões no ledger à mão.

**Pré-condição dura de C1:** o front com `mergeRealtimeUpdate` precisa estar em prod nas DUAS interfaces, V5 e clássica, e, depois disso, é preciso esperar um dia útil para as abas abertas no bundle antigo morrerem. Não existe reload forçado do bundle. O motivo: C1 tira do heap o `raw_payload` de cerca de 14% das mensagens (menus, botões e pix). Com isso, o UPDATE do Realtime passa a chegar sem esse campo, e o bundle antigo apaga o display da bolha.

A clássica (`classic/`) é servida por padrão a 114 de 120 orgs e ainda substitui a linha no UPDATE (`classic/src/modules/communication/hooks/chat/useWhatsAppRealtime.ts:100-104`). O SELECT dela não traz `raw_payload`, só as projeções. A portabilidade está na trilha `perf/classic-port-front-perf`, e sem ela em prod C1 não sobe.

Prova: `node --test tests/integration/whatsapp-messages-hot.test.mjs` (PGlite).

### O que o teste mostrou (fluxo calibrado na distribuição de prod)

| Config | UPDATE fora da página (`newpage/upd`) | heap (páginas) |
|---|---|---|
| hoje (100 / ~2 kB) | 27,6–28,3% (prod medido: 25–29%) | 305–311 |
| 90 / 1024 (descartado) | 12,3% | 276 |
| **C1: 85 / 1024** | **3,2%** | **260** |

- O gatilho do TOAST é fixo (~2 kB, `heapam.c`); `toast_tuple_target` só muda o alvo. Ele move para o toast as ~14% de tuplas com `raw_payload` > 2 kB comprimido inline. As 82% entre 1 e 2 kB não mudam.
- Com tupla de ~1,36 kB (p50 de prod), fillfactor 90 e 85 empacotam 5 tuplas por página, igual a 100. A sobra (~800 B) não comporta outra versão da linha. O ganho vem da mistura de larguras.
- **Decisão do CTO (2026-10-05): 85.** O 90 nasceria com 12%, acima do critério de 10%. Com 85 o heap fica menor que com 90, porque há menos cópia de linha para página nova.

## Parte 2 — protocolo

- **T0** = 2026-10-05 16:01 UTC. **Reavaliação** a partir de 2026-10-12 16:00 UTC.
- **Snapshot diário às 23:00 UTC**: `scripts/perf/whatsapp-messages-index-snapshot.sql`. O script só lê views de estatística e nunca faz `count(*)` na tabela. Ele sai como uma linha JSON, que se salva em `.specs/perf/whatsapp-messages-indexes/snap-AAAA-MM-DD.json`.
- **Restart zera os contadores**: `meta.postmaster_start` marca o segmento. Os deltas são somados dentro de cada segmento, nunca através de um restart.

Queries: Q1 `pg_stat_user_indexes` (scan, tup_read/fetch, `last_idx_scan`) das 3 tabelas · Q2 `pg_stat_user_tables` de whatsapp_messages · Q3 `pg_statio_user_indexes` · Q4 `pg_stat_statements` de INSERT/UPDATE (o PostgREST embrulha em `WITH pgrst_source AS (...)`).

### Critério D+7 por índice

- **(a) DROP**: Δscan = 0, `last_idx_scan` < T0 e nenhum chamador mapeado.
- **(b) EXPLAIN**: 0 < Δscan < 100. Rodar `EXPLAIN` do chamador sem o índice (`BEGIN; DROP INDEX …; EXPLAIN …; ROLLBACK;` fora do pico). DROP se o custo ficar ≤ 2× e o chamador não for o chat nem a caixa.
- **(c) MANTER**: Δscan ≥ 1000, ou o índice é UNIQUE, ou cobre FK.

### Candidatos e chamadores

| Índice | Tamanho | Chamadores mapeados |
|---|---|---|
| `idx_whatsapp_msgs_org_instance_phone` | 328 MB | `get_conversas_do_lead`, `get_whatsapp_conversation_list`, `mirror_workflow_button_message` |
| `idx_whatsapp_msgs_org_dir_ts` | 253 MB | `_metric_leaf_tempo_resposta` |
| `idx_whatsapp_messages_direction` + `_instance` | 194 + 39 MB | `whatsapp-health-monitor` |
| `idx_whatsapp_msgs_org_inst_dir_ts` | 188 MB | `src/contexts/ChatBubbleContext.tsx` (~300), badge (decisão de 06/09) |
| `idx_whatsapp_msgs_org_lead` | 176 MB | — |
| `idx_whatsapp_messages_normalized_phone` | 44 MB | — |

O potencial é de ~1,2 GB. Ficam fora: `instance_jid_ts` (`history-sync-worker/index.ts:194` e `whatsapp-webhook/handler.ts:1201`), `unprocessed` (`sz-chat-webhook/index.ts:500-540`), `messages_phone` (`_shared/whatsapp-providers/meta-cloud-window.ts:42`) e `unread_cover`, que é usado por `get_unread_counts` e `awaiting_human_reply_multi`.

### Critério do HOT (C1)

Nas páginas novas, ou seja, no delta de Q2 após o apply:

- `Δn_tup_newpage_upd / Δn_tup_upd < 5%`: C1 resolveu.
- Entre 5% e 10%: observar mais 7 dias.
- `≥ 10%`: baixar para 80. O modelo do teste prevê 3,2% para 85 e 0,3% para 80.

## Leitores de `raw_payload` (impacto do toast)

Quando a linha vai para o toast, cada leitura do `raw_payload` passa a buscar os chunks no toast. Os leitores são:

- `src/modules/communication/lib/whatsappMessagesQuery.ts:58`: SELECT do chat com 9 projeções `raw_payload->…`. Cada projeção destoasta a linha externa.
- `supabase/functions/_shared/workflow-question-image.ts:46`: leitura por id.
- SQL: `20271020000060_workflow_button_questions.sql:127-184` (`buttonOrListid`, `quoted`, `fromMe`), `20271020000069_workflow_button_chat_mirror.sql:28` (merge no upsert) e o trigger `20271019000000_whatsapp_saved_contact_name.sql:5`, que lê `NEW`, em memória, sem custo de toast.
- **Realtime: corrigido neste PR, pré-requisito do apply.** whatsapp_messages está em `supabase_realtime` com `REPLICA IDENTITY DEFAULT`, e o wal2json v2 pula a coluna TOAST inalterada.
  - Por isso, num UPDATE de `status`, o `raw_payload` chega AUSENTE, sem placeholder. O `realtime.apply_rls` só conseguiria recuperá-lo do registro antigo, que nesse modo traz só a PK.
  - Antes, `useWhatsAppRealtime.ts` trocava a mensagem inteira e a bolha perdia o menu, os botões ou o pix.
  - Agora o hook funde a linha com `mergeRealtimeUpdate` (`hooks/chat/shared/realtimeUpdate.ts`): chave ausente ou `undefined` mantém o valor do cache; `null` explícito sobrescreve.
