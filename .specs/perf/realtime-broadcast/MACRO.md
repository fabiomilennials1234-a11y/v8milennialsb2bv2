# Realtime: postgres_changes → Broadcast from Database (macro)

Arquiteto, 2026-10-06. Base origin/main f884118f9. Prod `jsjsmuncfkbsbzqzqhfq` só leitura.

## G0 — bloqueio
> **Superado em 19/10/2026.** O 42501 vinha de `ALTER TABLE realtime.messages` no mesmo arquivo, não do CREATE POLICY: `supautils.policy_grants` delega CREATE/ALTER/DROP POLICY ao `postgres`. Ensaio em prod (autorizado pelo CTO) passou. Ver `.specs/perf/fora-do-banco.md` §3 e `S1.md`. O texto abaixo é o de 06/10.

`realtime.messages` pertence a `supabase_realtime_admin`; `postgres` não é membro; 0 policies. `CREATE POLICY` → 42501 (ADR-0021:15,32). Canal privado sem policy de SELECT não entrega nada. **Desbloqueio: ticket no suporte Supabase** (grant do role ao postgres, ou eles criam as policies). Sem G0 só S0 avança.

## Custo atual (05/10 15:55 → 06/10 11:45 UTC)
- Poll `SELECT wal->>…` (apply_rls por evento × assinante): 88.361 chamadas, 2.381 s = **10,7% do tempo do banco**, ~4.200 blocos/chamada, máx 13,7 s.
- `with sub_tables…` (join de assinatura): 60.744 chamadas, ~51 joins/min com só 427 assinaturas vivas (churn: canal com randomUUID, sem dedup).
- `IncreaseSubscriptionConnectionPool: Too many database timeouts`: 1.117/24 h (o "canal zumbi").
- 56 `PoolingReplicationError` no pico (poll cancelado = evento perdido pra todos).
- whatsapp_messages: 74% dos eventos são UPDATE; 69 assinaturas (24 usuários). pipelines/pipeline_stages: 80/76 assinaturas para ~0 eventos.

## Desenho alvo
Trigger AFTER ROW → `realtime.send(payload allowlist, event=tabela, topic, private=>true)`. RLS roda por **join** (cacheado na conexão), não por evento. `realtime.send` engole erro como WARNING (não derruba webhook). Não usar `broadcast_changes()` (serializa NEW/OLD inteiros: raw_payload, search_tsv, PII).

Tópicos: `org:{org}:pe` · `org:{org}:wa:i:{instance}` · `org:{org}:wa:full` · `org:{org}:sig` · `lead:{lead}` · `user:{uid}`.
Predicado único `private.realtime_can_join(topic)` (DEFINER, STABLE, search_path=''); policy `rt_broadcast_select` em realtime.messages só SELECT (sem INSERT → cliente não publica). RPC `realtime_subscription_plan()` = fonte única pro front. Triggers `UPDATE OF` só colunas usadas pelo front. `app.rt_mute` pra operação em massa. Envelope `{v:1,t,op,id,seq,row,old?}`. Flag por org `transport ∈ {pg_changes, broadcast}`; cliente assina UM transporte. Reconciliação (#2238/#2241) mantida.

## Segurança (bloqueante)
- whatsapp_messages tem 2 dimensões de visibilidade (instância RESTRICTIVE + responsável via `can_see_chat`). **Tópico org-wide proibido.** Org com `chat_restrict_to_owner` (3: Goletric Pinheiros, Goletric Perdizes, Riofix): trigger publica só em `wa:full`; não-responsáveis seguem em postgres_changes (híbrido).
- Revogação passa a valer na expiração do JWT (hoje imediata) — decisão D2.
- `realtime.messages` guarda cópia 3 dias (LGPD) — payload enxuto.
- **Achado lateral, vazamento ativo:** `channel_messages_org_access` PERMISSIVE (`organization_id IN get_my_organization_ids()`) anula `select_by_owner` → nas 3 orgs restritas qualquer membro lê mensagem social de outro responsável (REST + realtime). Corrigir antes de S3.

## Fatias
- **S0 (sem G0):** dedup de canal por (tabela, filtro) por aba (`useRealtimeChannel.ts:165`); remover 11 assinaturas em tabelas fora da publication + `usePatchedRealtime` morto; unir bolha+chat; tirar 5 tabelas sem consumidor da publication. Aceite: assinaturas/usuário ~14 → ≤5; timeouts de pool <10/h no pico; joins/min −60%.
- **S1:** fundação + piloto pipeline_entries.
- **S2:** whatsapp_messages (aceite: poll `SELECT wal->>` −70% no pico; testes de segurança com controle positivo).
- **S3:** channel_messages (depois do fix do vazamento).
- **S4:** invalidação genérica → `org:sig`, `lead:{id}` (6 canais → 1), `user:{uid}`.
- **S5:** canais privados, desliga "Allow public access", esvazia publication.
Tudo em `src/` **e** `classic/src/` + `scripts/ui-classic/classic.patch`.

## Decisões do CTO
D1 ticket Supabase (G0) · D2 revogação = exp do JWT · D3 híbrido em org restrita (recomendado) · D4 payload allowlist (recomendado) · D5 plano B se G0 negado · D6 corrigir vazamento de channel_messages já.
