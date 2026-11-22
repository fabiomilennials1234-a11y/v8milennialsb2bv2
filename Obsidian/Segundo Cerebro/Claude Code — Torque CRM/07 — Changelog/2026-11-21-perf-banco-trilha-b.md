---
type: changelog
title: "2026-11-21 — Perf do banco (pacotes 2–4, Trilha B): Funil, Chat e Comando"
status: active
created: 2026-11-21
updated: 2026-11-21
tags: [changelog, perf, funil, chat, whatsapp, comando, rls, definer]
related: ["[[2026-11-21-perf-boot-trilha-a]]"]
owner: claude-agent
---

# 2026-11-21 — Perf do banco (Trilha B)

NÃO aplicado em prod. Validado numa branch Supabase espelhada de prod (funções, views `private.*`, policies) com massa sintética.

## Mudanças
- **Funil**: `get_pipeline_board` (INVOKER) devolve a 1ª página de todas as colunas + contagens numa chamada; o front semeia as chaves de sempre (`pipelinePageKey`, `stageCountsQueryKey`). "Carregar mais", move e Realtime intactos. RPC ausente (PGRST202) ⇒ N páginas como antes.
- **Funil**: `get_funil_desfecho_por_mes` pré-filtra card com negócio ou em etapa won/lost antes do JOIN com leads.
- **Funil**: `CreateOpportunityModal` só busca dado com o modal ABERTO (o fechado pagava `pipeline_entries?limit=500` com embeds).
- **Chat**: `get_whatsapp_conversation_list_multi` devolve `saved_contact_name` (some o fetch por caixa ao resumo) e conta marcadas como não lida sem sonda por linha.
- **Chat (área frágil, DEFINER)**: `whatsapp_thread_manifest` vira SECURITY DEFINER que reproduz a RLS de SELECT de `whatsapp_messages` com gate 1×, predicados strict/balcão por linha só quando ativos e TRIPWIRE de policies (`private.whatsapp_messages_policy_fingerprint`): policy nova sem revisar a função ⇒ a função recusa.
- **Chat**: `private.whatsapp_readable_message_instance_ids()` em conjunto (sem `whatsapp_chip_instance_ids` por caixa) — corta o InitPlan de toda leitura RLS de mensagens/resumo.
- **Chat**: lista do canal oficial calcula os gates constantes por chamador uma vez (com guarda de md5 dos corpos revisados).
- **Comando**: `get_comando_fila` (INVOKER) — fila + nome/dono do lead numa ida, caixas resolvidas no servidor; front não espera mais a lista de caixas.
- **Índices** (CONCURRENTLY, 1 arquivo cada): pipeline_entries (pipeline_id, created_at, id); conversation_read_state parcial marked_unread; whatsapp_messages (org, telefone, ts, id) e cobertura de recebidas com lead_id.

## Arquivos tocados
- `supabase/migrations/20280123000000…001000` (11) + `rollback/` (11).
- `supabase/tests/`: `funil_quadro_numa_chamada_test`, `desfecho_pre_filtro_test`, `readable_message_ids_set_based_test`, `manifest_definer_isolamento_test`, `lista_multi_nome_salvo_test`, `lista_oficial_gates_test`, `comando_fila_test`, `_perf_old_snapshot.sql`.
- `src/modules/pipelines/lib/pipeline-board-query.ts` (novo), `stage-counts-query.ts`, `hooks/model/usePaginatedFunil.ts`, `hooks/perf/usePrefetchPipes.ts`, `components/kanban/CreateOpportunityModal.tsx`.
- `src/modules/communication/hooks/chat/useConversasUnificadas.ts`, `shared/enriquecerContatos.ts`.
- `src/modules/analytics/hooks/useConversasAguardando.ts`.

## Decisões
- `get_comando_fila` INVOKER: DEFINER leria `leads` sem RLS e entregaria nome de lead invisível (provado na branch: membro com 18 linhas na fila vê 6 nomes; DEFINER mostraria 18).
- Café Jurerê NÃO tem `strict_lead_owner_access` em prod (só JR Tex e uma org sem caixas) — os relatórios de 21/11 o chamavam de strict.

## Follow-ups
- DROP de `idx_whatsapp_messages_normalized_phone` / `idx_whatsapp_msgs_unread_cover` / `idx_pe_pipeline_stage_created` só depois de medir idx_scan em prod.
- `useFunilMetrics` ainda pede a contagem sozinho no mount (uma ida a mais); ler do quadro.
- Reconciliar no repo os objetos prod-only (`private.*`, policies de `whatsapp_messages`).
