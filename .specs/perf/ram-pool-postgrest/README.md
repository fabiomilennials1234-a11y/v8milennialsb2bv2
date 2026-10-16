# RAM e pool do PostgREST em prod — diagnóstico e plano

Data: 16/10/2026. Estado: **diagnóstico fechado, nada implementado, nada alterado em prod.** Medições só de leitura, autorizadas pelo CTO.

Projeto `jsjsmuncfkbsbzqzqhfq`, compute Medium: 4,0 GB de RAM, 2 vCPU, `shared_buffers` 1 GB, `max_connections` 120, pool do PostgREST 25 (`db_pool`, reduzido de 40 em 06/10). Banco no ar desde 05/10 15:55 UTC.

## Conclusão

1. **A RAM não acompanha a carga.** Na janela de 15 min medida no expediente (16/10, 18:02–18:17 UTC), o banco executou 314 s de SQL. Isso dá **0,35 núcleo e 0,35 conexão ocupada em média**. Mesmo assim, a RAM ficou em 83%. Quem ocupa a RAM é a quantidade de processos Postgres vivos e o tamanho de cada um, não o trabalho feito.
2. **O pool satura em rajadas, não por volume.** Na média ele fica quase ocioso. Só que a pesquisa de telefone da tela Leads dispara 6 consultas de ~1 s em paralelo a cada tecla, e outras telas fazem parecido. Cada rajada força o pool até o teto (25). Os backends abertos nessa hora continuam vivos, inchados com o catálogo do schema. Medido: `waiting` 10 às 17:50 e 7 às 18:19; 239 timeouts de pool entre 15:04 e 17:50.
3. **A premissa "edge functions ocupam o pool" não se sustenta como alavanca principal.** O `service_role` (edge functions) faz 54% das chamadas, mas responde por apenas 6,9% do tempo do banco na janela (8,2% no acumulado). O `authenticated` (navegador) fica com 70%. Conexão direta via Supavisor cai nos mesmos backends: não reduz RAM e pode piorar. **Rejeitada.** O ganho nas edge functions vem de juntar chamadas em RPC e de tirar trigger síncrono do INSERT.
4. As médias acumuladas no `pg_stat_statements` (desde 05/10) estão **poluídas pela regressão do `strict_lead_owner` (13–14/10)**. `get_unread_total`, por exemplo, mostra 438 ms acumulado e 36 ms hoje. Este plano usa a janela de 15 min.

## Para onde vai a RAM (pico de 16/10, 17:50 UTC)

| Parcela | GB | Natureza |
|---|---:|---|
| `shared_buffers` (Shmem) | 1,08 | Fixo, 25% da RAM. O painel conta como usado. Hit ratio 99%. Não mexer. |
| Memória privada dos processos (AnonPages) | 1,80 | Foi de 0,94 GB às 15:04 para 1,80 GB às 17:50. Inclui 23 backends do PostgREST, 11 do Realtime (WAL, vida longa), Storage, Auth e PostgREST. |
| Kernel, page tables, slab | ~0,4 | Fixo. |
| **Usado** (`1 − MemAvailable/MemTotal`) | **3,35 (83%)** | |

Cada backend do Postgres guarda em cache o catálogo de tudo que já tocou. O schema tem **1.092 policies, 1.327 funções, 2.019 relações e 323 triggers**, e o backend do PostgREST atende qualquer tela, então cedo ou tarde toca quase tudo. Em 06/10 o medido foi ~40 MiB por backend em 30 min. O pool recicla mal: há backends com 3 a 20 h de vida.

Fórmula que governa:

```
RAM usada ≈ 1,08 GB fixo + 0,4 GB kernel + Σ backends vivos × tamanho de cada um
backends do PostgREST vivos ≈ pico de concorrência das últimas horas (não a média)
```

**Meta de 50% (2,0 GB):** sobram ~0,5 GB para processos. Os caminhos são três: menos backends (cortar rajadas e então reduzir o pool), backends menores (dieta do catálogo) ou mais RAM (compute Large: 8 GB, `shared_buffers` 2 GB, mesma fórmula com folga).

## Carga real — janela de 15 min (16/10, 18:02–18:17 UTC)

| % do tempo | Chamadas/min | ms/chamada | Role | Alvo |
|---:|---:|---:|---|---|
| 16,5 | 118,7 | 29 | supabase_admin | Realtime `postgres_changes`, poll do WAL |
| 10,6 | 2,1 | 1.041 | authenticated | `lead_phones` `ilike '%x%'` (busca de telefone) |
| 8,5 | 81,5 | 22 | authenticated | `notifications` (polling de avisos) |
| 8,4 | 22,3 | 78 | authenticated | RPC (lista do chat / pipeline) |
| 10,3 | ~4 | 500–550 | authenticated | 2 RPCs pesadas (lista multi do chat) |
| 3,3 | 11,7 | 59 | authenticated | `lead_tags` |
| 3,2 | 27,5 | 24 | service_role | INSERT `whatsapp_messages` (webhook) |
| 1,8 + 1,2 | 10,7 + 6,1 | 36–41 | authenticated | `get_unread_total` / `get_unread_counts` (corrigidos em 14/10) |
| 4,3 | 3 | 300 | postgres | crons: `cron_dispatch_minute`, varreduras de avisos |

Por role: authenticated 70,2% · supabase_admin 17,1% · service_role 6,9% · postgres 5,8%.

## Diagnóstico por frente

### F1. Polling de `notifications`, 81,5 chamadas/min contínuas
- `src/modules/platform/hooks/useAvisos.ts:43,146-147`: `refetchInterval: 30_000` com `refetchIntervalInBackground: true`. Roda em toda aba aberta, inclusive escondida, 24/7.
- O canal realtime já entrega os avisos com `setQueryData` (`useAvisos.ts:158-176`). O polling ficou como rede de segurança e roda sem olhar o estado do canal.
- Montado em toda rota por `PilhaDeCartoes.tsx:40` (via `App.tsx:948`). O sino (`AlertsDropdown.tsx:85`) usa a mesma queryKey e não duplica.
- Índice `notifications_recipient_org_unread_idx (user_id, organization_id, read_at, last_event_at DESC)` (`20260831200000_avisos_fundacao.sql:91-92`): `read_at` no meio impede servir a ordenação `last_event_at DESC NULLS LAST`. Hipótese não confirmada por EXPLAIN.
- **Fix:** intervalo condicionado ao canal (`false` com o canal `joined`; 30 s só com ele degradado), reaproveitando `useReconcileInterval` (`src/shared/realtime/useRealtimeFallback.ts:89-107`). Mais `refetchIntervalInBackground: false`, refetch ao voltar para a aba e índice `(user_id, organization_id, last_event_at DESC NULLS LAST)`.
- **Ganho:** ~81 → ~5 chamadas/min (−90%). ~8% do tempo do banco e ~1,3 req/s a menos.
- **Tradeoff:** aviso atrasa se o canal cair sem mudar de estado. Mitigação: sonda de 5 min mais refetch no foco. Em aba escondida, o som e o cartão chegam só quando a aba volta, se o realtime tiver caído.

### F2. Busca de telefone na tela Leads, a rajada que satura o pool
- `src/modules/leads/hooks/useLeadPhones.ts:61`: `.ilike("normalized_phone", '%digits%')`. Os índices btree (`20271112000000_lead_phones_contatos_nomeados.sql:75-80`) não servem para `%` no início, então o banco varre a org inteira (~109 mil buffers, ~1 s).
- `src/modules/leads/pages/Leads.tsx:367-376`: 1 `useLeads` + 5 `useLeadsCount`, cada um chama `buscarLeadIdsPorTelefoneSecundario`. São **6 consultas idênticas por termo**.
- `Leads.tsx:270-273,852-853`: sem debounce, mínimo de 4 dígitos (`lead-list-filters.ts:122`). Um número de 11 dígitos gera **48 consultas de ~1 s em ~2 s, 6 em paralelo**: um usuário digitando ocupa um quarto do pool. Mesmo padrão em `lead-list-filters.ts:197`, sobre `leads.normalized_phone`.
- **Fix:** debounce de 300 ms; resolver os ids secundários uma vez por termo (`queryClient.fetchQuery` com staleTime de 60 s, 6 → 1); índice GIN `pg_trgm` parcial (`WHERE deleted_at IS NULL`) em `lead_phones.normalized_phone` e `leads.normalized_phone`.
- **Ganho:** 48 → 1–2 consultas por busca, 1 s → dezenas de ms. Some a principal rajada observada. ~10% do tempo do banco.
- **Tradeoff:** +300 ms percebidos na busca. GIN tem custo de escrita e espaço, e o sync do ERP grava muito em `lead_phones`: medir o tamanho do índice e o tempo de upsert do sync. Alternativa mais barata, se o produto aceitar "termina com": índice em `reverse(normalized_phone) text_pattern_ops`.

### F3. Lista multi do chat refeita a cada envio
- `get_whatsapp_conversation_list_multi`: ~500 ms por chamada na janela. Chamador: `useConversasUnificadas.ts:217-312`, com dois consumidores (`ChatShellWithContext.tsx:840` e a bolha, `ChatBubbleConversationList.tsx:108`).
- Toda mensagem enviada invalida a raiz `["whatsapp_contacts"]` sem throttle: `useWhatsAppSend.ts:426,709`, `useWhatsAppConversations.ts:141,164,200,254,284`, `useWhatsAppLeadIntegration.ts:523,610`, `useWhatsAppSzChat.ts:41`, `useConversationBatch.ts:51`. O realtime já aplica o INSERT outgoing na linha.
- **Fix:** trocar a invalidação por `setQueriesData` (patch) ou por `pedirReconciliacaoDaLista` (throttle de 15 s, respeita aba oculta, `chatReconcile.ts:30`).
- **Ganho:** −30 a −50% das chamadas da lista (estimativa; volume de envios não medido).
- **Tradeoff:** se o realtime perder o evento outgoing, a ordem ou a prévia da conversa ficam desatualizadas até o backstop de 300 s ou o foco.

### F4. Unread — rebaixado
Corrigido em 14/10: 36–41 ms, ~17 chamadas/min, já por evento com throttle de 20 s (`unreadRefresh.ts:53`). A tabela de contadores (O(1) por conversa no lugar da varredura de 7 dias em `whatsapp_messages`) fica para depois. Hoje não paga o risco de vazar contagem entre donos (`chat_restrict_to_owner` / `strict_lead_owner`).

### F5. Edge functions — o que vale e o que não vale
- 100% via supabase-js, ou seja, PostgREST. Nenhuma usa conexão Postgres direta.
- **Rejeitado:** Supavisor ou conexão direta. Mesmos backends, TCP+TLS+SCRAM por request (~1,2 request por isolate, EarlyDrop), risco de estourar `max_connections` e senha do `postgres` no env da edge.
- **Vale:**
  - **F5a. RPC de ingest do Uazapi.** O webhook `messages` faz 6 chamadas sequenciais por evento (`whatsapp-webhook/handler.ts:1545,1592,1161,1005,1046,1055`) mais um SELECT redundante em `:700`, porque o id já vem de `:1046`. Os recibos fazem 4–5 (`message-update.ts:145,209,217,225`). Juntar em `ingest_uazapi_message` / `apply_uazapi_receipt` dá 6 → 2 chamadas. Ganho: latência na edge e −3 a −6% na ocupação do pool. Tradeoff: lógica de DLQ, CAS e arbitragem de botão migra para plpgsql (mais difícil de testar). A RPC precisa ser DEFINER, resolver a org dentro dela (nunca por parâmetro), executar só para service_role e ter REVOKE explícito.
  - **F5b. Triggers no INSERT de `whatsapp_messages`.** 8 triggers síncronas (baseline + `20271019000000`): lead_id, normalize, enqueue de webhooks, human pause, conversation summary, history, response detection, saved contact name. Suspeita principal dos 24–94 ms por linha. Não confirmado: `track_functions = none` em prod. Tornar assíncronas as que não precisam ser síncronas (history, summary, webhooks de saída). Tradeoff: consistência eventual; quem lê history/summary logo após o INSERT veria o estado antigo.
  - **F5c. Token do Google.** `_shared/google-calendar-utils.ts:153-187` renova o token no Google e faz UPDATE em **toda** leitura de agenda, em série por dono (`google-calendar-events/index.ts:268-270`). Isso gera disputa de lock na mesma linha. Fix: reaproveitar o token até `expires_at`. Ganho: ~1,7% do banco e ~64 mil UPDATEs, além de menos chamadas OAuth.

### F6. Realtime `postgres_changes`: 16,5% do tempo, fora do pool, mas com RAM própria
Poll do WAL a 118 chamadas/min e 11 backends de vida longa. A migração para Broadcast segue bloqueada pelo G0 (ticket Supabase: `postgres` não é dono de `realtime.messages`). Fora desta trilha.

## Plano

Ordem por ganho/risco. Cada onda tem medição antes e depois com a mesma régua (delta de 15 min do `pg_stat_statements` no expediente, mais RAM, `pgrst_db_pool_waiting` e `timeouts_total` no endpoint de métricas).

| Onda | Escopo | Tipo | Área frágil | Ganho esperado | Risco |
|---|---|---|---|---|---|
| **1** | F2 (debounce, dedupe, trigram) + F1 (polling condicionado + índice) | front + 2 migrations de índice (`CREATE INDEX CONCURRENTLY`) | não | −18% do tempo do banco; some a rajada de 6 × 1 s; −1,3 req/s | baixo |
| **2** | F3 (invalidação da lista) + F5c (token Google) | front + 1 edge fn | WhatsApp (só cache, sem mudar escopo) | −5 a −8% | baixo |
| **3** | Reduzir o pool 25 → 15 com as ondas 1 e 2 no ar e `waiting` 0 no pico por 3 dias | config (`PATCH /postgrest`) | não | −10 backends vivos ≈ −0,4 GB de RAM (estimativa, a 40 MiB cada) | médio: se houver outra rajada, voltam os timeouts. Reverter = `{"db_pool":25}` |
| **4** | F5a (RPC de ingest do Uazapi) + F5b (triggers assíncronas) | migration + edge fn | **WhatsApp/Uazapi, multi-tenant**: rubric de segurança obrigatório | latência do webhook ↓; −3 a −6% do pool | médio-alto |
| **5** | Dieta do catálogo: aposentar policies, funções e views mortas | migrations | RLS | backend menor, ganho em todos os backends | alto: precisa inventário de uso |

**Projeção (estimativa, não medida):** as ondas 1–3 levam o pico de ~83% para ~65–70%. Chegar a 50% no Medium exige a onda 5 ou o compute Large. O Large dá 50% imediato, mas sem as ondas 1–3 a rajada continua gerando timeout, porque o pool é o mesmo.

## Critério de sucesso
- Pico de RAM ≤ 65% depois da onda 3; ≤ 50% depois da onda 5 ou do Large.
- `pgrst_db_pool_waiting` = 0 e delta de `pgrst_db_pool_timeouts_total` = 0 no pico (09–18h BRT) por 3 dias úteis seguidos.
- `notifications` ≤ 10 chamadas/min; `lead_phones` < 50 ms por chamada e ≤ 2 por busca.

## Hipóteses abertas
1. Os 22 ms/118 ms de `notifications` vêm do sort sem índice útil? Confirmar com EXPLAIN como `authenticated`. O Management API recusa `SET ROLE`; usar `supabase db query --linked` com claims ou uma branch.
2. Quanto do AnonPages é do PostgREST e quanto é do Realtime. Sem visão por processo no endpoint de métricas. Medir indiretamente: RAM antes e depois da onda 3.
3. Por que backends do pool vivem 3–20 h, se o `db-pool-max-lifetime` documentado é 30 min. Perguntar ao suporte ou ver a config efetiva.
4. Custo real das 8 triggers de `whatsapp_messages`. Exige `track_functions = pl` (pedido ao suporte) ou EXPLAIN ANALYZE numa branch.
5. Em que horário caíram os 14.199 timeouts do pool. A API de logs migrou para `/analytics/endpoints/logs` (ClickHouse) e respondeu "Backend error" em 16/10. Tentar de novo.
6. `get_pipeline_page` e `whatsapp_thread_manifest` não foram investigados.

## Fontes
- Endpoint de métricas: `https://<ref>.supabase.co/customer/v1/privileged/metrics` (Basic `service_role`).
- `extensions.pg_stat_statements`: snapshots em 18:02:23 e 18:17:25 UTC, delta por `queryid` e role.
- Diagnóstico de código: duas leituras independentes do repo (front e edge functions), com `arquivo:linha` acima.
