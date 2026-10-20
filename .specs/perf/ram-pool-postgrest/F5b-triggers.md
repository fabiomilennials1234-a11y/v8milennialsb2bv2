# F5b — triggers de INSERT em `whatsapp_messages`

Data: 2026-10-19. Fonte: prod `jsjsmuncfkbsbzqzqhfq`, somente leitura (pg_trigger, pg_get_functiondef, pg_stat_statements, EXPLAIN ANALYZE de SELECT).
Teste/medição: `tests/integration/whatsapp-messages-insert-triggers.test.mjs` (PGlite, corpos reais de prod).

## Conclusão
A suspeita do plano ("8 triggers síncronas") não se confirma como causa. São **17** triggers em prod, mas o custo está em **dois lookups sem índice**, dentro de triggers que precisam continuar síncronas:

1. `resolve_message_lead_id`, passe 2: `normalize_br_mobile(phone_digits)` avaliado por linha da org (função com `SET search_path`, não é inlinada). Prod, maior org: **239 ms** por INSERT de telefone desconhecido. 75% das mensagens chegam sem lead.
2. `fn_whatsapp_message_to_history`, EXISTS de idempotência: lê todo o `lead_history` do lead e filtra jsonb. Prod, lead mais pesado: **618 ms e 4.703 páginas lidas do disco** por INSERT.

Nenhuma trigger sai do caminho síncrono. Fila assíncrona para history/summary/webhooks economizaria < 0,5 ms cada (PGlite), adicionaria até 60 s de atraso (o dispatcher roda por minuto) e quebraria leitores imediatos. Correção: dois índices, sem mudança de comportamento (`20271201000200`, `20271201000201`).

## Inventário (prod, 2026-10-19)
| Trigger | Timing | Função | O que faz | Decisão |
|---|---|---|---|---|
| trg_normalize_whatsapp_message_phone | BEFORE INSERT/UPDATE OF phone_number, ROW | normalize_whatsapp_message_phone | NEW.normalized_phone | fica: summary, unarchive e leitores dependem dela |
| trg_resolve_message_lead_id | BEFORE INSERT, ROW | resolve_message_lead_id | NEW.lead_id por 5 passes | fica (roteamento/dono). **Índice no passe 2** |
| trg_whatsapp_messages_set_media_file_name | BEFORE INSERT, ROW, WHEN document | whatsapp_messages_set_media_file_name | NEW.media_file_name | fica (BEFORE, muda a linha) |
| zz_riofix_bot_prepare_inbound | BEFORE INSERT, ROW, WHEN org Riofix | private.riofix_bot_prepare_inbound | bot da Riofix | fora do escopo (1 org) |
| trg_whatsapp_conversation_summary | AFTER INSERT, ROW | tg_whatsapp_conversation_summary | upsert por PK em whatsapp_conversation_summary | fica: a lista do inbox recarrega logo após o realtime do INSERT; `zz_capture…` faz UPDATE na mesma linha na mesma transação |
| zz_capture_whatsapp_saved_contact_name | AFTER INSERT, ROW | capture_whatsapp_saved_contact_name | UPDATE summary.saved_contact_name | fica (depende do summary na mesma transação) |
| trg_whatsapp_message_to_history | AFTER INSERT, ROW | fn_whatsapp_message_to_history | INSERT lead_history, idempotente por message_id | fica (sub-ms com o índice; a timeline do lead e o `api_lead_timeline` leem). **Índice hash** |
| trg_enqueue_whatsapp_messages_webhooks | AFTER INSERT, ROW, WHEN não history_sync | enqueue_whatsapp_messages_webhooks | INSERT webhook_deliveries por webhook ativo | fica: já é uma fila (drenada por process-webhook-deliveries); outra fila só acrescenta um salto |
| trg_human_pause_on_manual_send | AFTER INSERT, ROW, WHEN não history_sync | fn_human_pause_on_manual_send | pausa a IA quando há envio manual | fica (Copilot lê a pausa logo em seguida) |
| trg_whatsapp_response_detection | AFTER INSERT, ROW, WHEN incoming | trigger_whatsapp_response_detection | avança campanha/pipe waiting_response | fica (decide fluxo; índices parciais existem) |
| trg_unarchive_on_inbound | AFTER INSERT, ROW, WHEN incoming 1:1 | private.unarchive_conversation_on_inbound | desarquiva a conversa | fica (o inbox lê). Bloco EXCEPTION = subtransação por mensagem; custo baixo |
| trg_aviso_de_mensagem | AFTER INSERT, ROW, WHEN não history_sync | fn_aviso_de_mensagem | notifications por membro permitido (≤ 9) | fica (sino em tempo real). Não medido no PGlite |
| riofix_bot_inbound, riofix_bot_vendedor_assumiu, riofix_proposal_message_insert/update, riofix_reabrir_conversa_arquivada | AFTER, ROW, WHEN org Riofix | private.riofix_* | bot e propostas da Riofix | fora do escopo (WHEN barra as outras orgs) |

## Custo medido (PGlite, ms por INSERT incoming)
Limite: PGlite é PG 18 em WASM, single-thread, sem I/O nem concorrência. Vale o custo **relativo**. Volume calibrado em prod: 11.300 leads na org, lead pesado com 15.219 linhas de histórico, 40 leads comuns com 170 linhas.

| Variante | U (sem lead, 75% de prod) | H (lead pesado) | N (lead comum) |
|---|---|---|---|
| todas | 52,57 | 2,85 | 0,42 |
| sem resolve_message_lead_id | 0,38 | 2,81 | 0,38 |
| sem message_to_history | 53,69 | 0,36 | 0,32 |
| sem conversation_summary | 51,94 | 2,56 | 0,35 |
| sem enqueue_webhooks | 53,07 | 2,83 | 0,33 |
| sem saved_contact_name | 53,32 | 2,97 | 0,39 |
| sem response_detection | 54,39 | 3,13 | 0,38 |
| sem unarchive | 55,99 | 3,25 | 0,38 |
| nenhuma | 0,13 | 0,15 | 0,14 |
| **todas + índices F5b** | **3,00** | **0,31** | 0,32 |

Prod: o INSERT principal do webhook tem média de 40,67 ms (165.841 chamadas, pg_stat_statements). Estimativa ponderada pelo fluxo de 24 h: passe 2 ≈ 11 ms por INSERT, EXISTS do histórico ≈ 7 ms (em média 171 linhas varridas, pior caso 618 ms).

## Por que fila e DEFERRABLE não resolvem
- `DEFERRABLE INITIALLY DEFERRED` só vale para constraint trigger e roda no COMMIT da mesma transação: o backend do PostgREST paga igual.
- Fila drenada pelo `cron-dispatch-minute` libera o pool, mas o trabalho continua no banco. O ganho são frações de ms, em troca de até 60 s de inbox e timeline defasados.

## Rollback
`supabase/migrations/rollback/20271201000200_…` e `…201_…`: um `DROP INDEX CONCURRENTLY` cada. Nenhuma função depende dos índices; o comportamento volta a ser idêntico, só mais lento.

## O que medir em prod depois de aplicar
- `pg_stat_statements`: `mean_exec_time` do `WITH pgrst_source AS (INSERT INTO "public"."whatsapp_messages"…` (hoje 40,67 ms). Pegar o delta de 15 min no expediente, antes e depois.
- `pg_stat_user_indexes.idx_scan` de `leads_org_br_mobile_idx` e `lead_history_whatsapp_message_id_idx` > 0. Se ficar em 0, o planner não está usando o índice.
- `pg_stat_user_tables` de `lead_history`: `seq_tup_read`/`idx_tup_fetch` caem. `pg_statio_user_tables.heap_blks_read` de `lead_history` cai.
- Opcional: `track_functions = pl` (pedido ao suporte) para ver o tempo por função de trigger.

## Aberto
- Passe 3 (`right(phone_digits, 11)`): 21 ms na maior org e ~2,7 ms no PGlite (o que sobra em U). Há 17 grupos ambíguos por sufixo em prod, e o `LIMIT 1` sem `ORDER BY` passaria a escolher outro lead. Mexer nisso exige decidir o desempate: é uma mudança de roteamento, não uma troca de índice.
- Riofix e aviso não entraram no PGlite.
