# Inventário da projeção de dinheiro — SCRUM-647

Fonte: `pg_get_functiondef` / `pg_get_viewdef` contra **produção**
(`jsjsmuncfkbsbzqzqhfq`), 2026-09-03. O repositório não foi usado como fonte:
ele diverge de prod em pelo menos 2 pontos apontados abaixo.

Recorte: toda função SQL viva de `public` que traduz
`pipeline_entries.metadata` em coluna tipada, seja **inline** (`metadata->>'x'`)
seja **pela view** de compat. Varredura: 114 funções lidas, **81** citam uma das
6 views ou fazem projeção inline.

---

## 0. A projeção, medida

A tradução vive hoje em **20 lugares**: 6 views de compat + **14** funções que
fazem o cast inline. A ficha do ticket dizia 13 — a lista estava errada nos dois
sentidos (ver §4).

Campos projetados e o cast **exato** da viewdef de prod:

| Campo | Cast na view de compat | Views que projetam |
|---|---|---|
| `sale_value` | `(metadata->>'sale_value')::numeric` | propostas |
| `closer_id` | `::uuid` | confirmacao, propostas |
| `sdr_id` | `::uuid` | whatsapp, confirmacao |
| `responsible_id` | `::uuid` | whatsapp, confirmacao, propostas |
| `pre_sale_responsible_id` | `::uuid` | as 4 de entrada |
| `sale_responsible_id` | `::uuid` | as 4 de entrada |
| `product_id` | `::uuid` | propostas |
| `product_type` | texto cru | propostas |
| `calor` | `::integer` | propostas |
| `loss_reason` | texto cru | propostas |
| `loss_reason_id` | `::uuid` | propostas |
| `commitment_date` | `::date` | propostas |
| `contract_duration` | `::integer` | propostas |
| `is_confirmed` | **`COALESCE((…)::boolean, false)`** | confirmacao |
| `meeting_date` | `::timestamptz` | confirmacao |
| `meet_link` | texto cru | confirmacao |
| `metrics_period_at` | `::timestamptz` | confirmacao, propostas |
| `scheduled_date` | `::timestamptz` | whatsapp |

`is_confirmed` é o único com `COALESCE`. As outras 17 são cast puro — e um cast
puro **estoura** em string vazia. Varredura de 48.140 entradas × 15 campos
tipados: **0 valores** que não sobrevivem ao cast. A projeção copia o cast
literal, então herda essa fragilidade sem aumentá-la.

`custom_pipelines` e `custom_pipeline_stages` ficam **fora** da projeção:
a primeira projeta de `pipelines.config` (não é entrada), a segunda é
passa-a-diante puro de `pipeline_stages` (não projeta nada).

---

## 1. Classe (a) — precisa da projeção

### 1.1 — Migradas nesta fatia (6)

Critério: leitura pura, cast idêntico ao da view, fora de policy de RLS.

| Função | Campos consumidos | Caminho antes |
|---|---|---|
| `api_get_lead` | `sale_value` | inline |
| `api_list_leads` | `sale_value` | inline |
| `get_next_pipe_closer` | `closer_id` | inline |
| `get_pipeline_lead_ids` | `pre_sale_responsible_id`, `sale_responsible_id` | inline |
| `get_meeting_reminder_candidates` | `scheduled_date` | inline |
| `get_seller_activity_scores` | `sdr_id`, `closer_id`, `metrics_period_at` | inline |

### 1.2 — Precisa da projeção, **NÃO** migrada, com o motivo

| Função | Campos | Por que fica |
|---|---|---|
| `get_revenue_attribution` | `sale_value` | `SUM(sale_value)` fora de `sale_events`: reemitir o corpo trip­aria `ledger-revenue`. Ver §3. |
| `get_segment_benchmark` | `sale_value`, `metrics_period_at` | idem |
| `get_win_loss_analysis` | `sale_value`, `loss_reason` | idem |
| `master_get_org_sales_summary` | `sale_value` | idem |
| `get_analytics_pipeline_metrics` | 6 campos, view **e** inline | idem + é a única híbrida |
| `get_funnel_health_stage_leads` | `sale_value` | `COALESCE` encadeando 3 chaves de atribuição (R5). Tirar muda **quem é creditado**. |
| `get_pipeline_page` | `calor`, `meeting_date`, `metrics_period_at`, `product_type`, par de responsáveis | cast **divergente** (§4) + `updated_at` como âncora (R4) |
| `get_pipeline_stage_counts_by_id` | idem | idem |
| `get_productivity_activity{,_by_seller,_leads}` | `closer_id` | `COALESCE(l.sale_responsible_id, l.closer_id, metadata→closer_id)` = R5 |
| `is_user_responsible_in_any_pipe` | os 5 papéis | **roda dentro de 4 policies de RLS** (`leads` SELECT+UPDATE, `lead_history`, `lead_custom_field_values`). Pôr view no corpo é risco de recursão na tabela mais quente do banco. Não vale por refatoração. |
| `get_leads_not_confirmed` | `is_confirmed`, `meeting_date` | divergência de `is_confirmed` (§4) |
| `fn_varredura_avisos_reuniao_proxima` | `meeting_date` | guarda `<> ''` própria (§4) |
| `distribute_pipe_round_robin` | `responsible_id` | trigger |

### 1.3 — Gatilhos: leem `NEW`/`OLD`, projeção **não alcança**

`NEW.metadata->>'x'` é campo de um registro, não de uma relação — não existe
view que substitua. Só um helper escalar resolveria, e helper escalar por linha
em trigger é custo em caminho de escrita.

| Função | Campos | Atada em |
|---|---|---|
| `fn_exige_valor_na_venda` | `sale_value` | `pipeline_entries` |
| `fn_capture_meeting_event` | `meeting_date`, `sdr_id`, `pre_sale_responsible_id` | (trigger) |
| `pipeline_entries_snapshot_responsibles` | os 4 papéis | `pipeline_entries` |

Escrita/backfill, alcançáveis mas fora do recorte de leitura desta fatia:
`fn_exige_valor_no_negocio` (trigger em `deals`), `garantir_negocio_da_entrada`,
`fn_backfill_state_sales`, `_registrar_desfecho_no_caderno` (este último com
divergência, §4).

---

## 2. Classe (b) — lê a view, mas **não** por dinheiro

34 funções. Consomem só `id` / `lead_id` / `organization_id` / `status`, ou
escrevem pelos `INSTEAD OF`. Fora do escopo desta fatia; continuam bloqueando
a SCRUM-639.

`_stage_is_final`, `_stage_key_label`, `apply_stage_checklist`,
`bulk_delete_leads`, `custom_pipeline_stages_{insert,update}_fn`,
`delete_pipeline`, `fn_log_pipeline_stage_change_history`, `fn_resolver_funil`,
`get_all_funnels_lead_ids`, `get_analytics_engagement_metrics`,
`get_leads_by_uf`, `get_leads_no_response_from_lead`,
`get_leads_team_no_response`, `get_next_best_actions`,
`get_pending_meta_conversion_signals`, `get_ranking_data`, `get_uf_heatmap`,
`import_lead_into_custom_pipeline`, `lead_excluded_from_metrics`,
`match_onboarding_templates`, `metric_stage_role`,
`pipeline_entries_stage_mirror`, `purge_lead`, `remove_demo_data`,
`seed_demo_data`, `sync_pipeline_entry_to_lead_pipe_whatsapp`,
`trigger_workflow_lead_created`, e os escritores
`abrir_negocio`, `create_lead_with_pipe`, `create_lead_from_social_conversation`,
`sync_responsible_from_lead_to_pipes`, `custom_pipe_entries_{insert,update}_fn`.

---

## 3. Classe (c) — mortas

Sem chamador textual em `src/`, em `supabase/functions/`, em nenhuma outra
função de prod, **e** sem trigger atado. As 6 primeiras retornam `trigger`:
o Postgres recusa chamada direta, então elas não são alcançáveis nem por
PostgREST. São mortas com prova, não por ausência de sinal.

| Função | Retorno | Triggers atados |
|---|---|---|
| `log_pipe_whatsapp_stage_change` | `trigger` | 0 |
| `log_pipe_confirmacao_stage_change` | `trigger` | 0 |
| `log_pipe_propostas_stage_change` | `trigger` | 0 |
| `trigger_workflow_stage_changed` | `trigger` | 0 |
| `validate_pipe_status` | `trigger` | 0 |
| `fn_auto_assign_lead_default_pipe` | `trigger` | 0 |

`custom_pipelines_check_vocab` retorna `void` e tem `EXECUTE` para **anon** —
alcançável por RPC. Sem chamador conhecido, mas **não** provadamente morta.

Efeito na SCRUM-639: 6 das 32 bloqueadoras caem por `DROP FUNCTION`, sem
migração nenhuma.

---

## 4. Divergências encontradas e **NÃO** corrigidas

Ordem do ticket: reportar, manter o comportamento, deixar a correção de número
para o CTO.

| # | Função | O que diverge da view | Efeito hoje |
|---|---|---|---|
| D1 | `get_leads_not_confirmed` | compara **texto cru**: `metadata->>'is_confirmed' IS DISTINCT FROM 'true'`. A view faz `COALESCE(…::boolean, false)`. | Inerte: prod só tem 2 valores distintos, `'true'` e `'false'`. Um `'t'`/`'TRUE'` gravado amanhã e a função passa a contar como "não confirmado" o que a view lê como confirmado. |
| D2 | `_registrar_desfecho_no_caderno` | `NULLIF(v_meta->>'sale_value','')::numeric`. A view não tem `NULLIF`. | Inerte: 0 strings vazias. Onde a view estouraria, esta devolve NULL. |
| D3 | `get_pipeline_page` e `get_pipeline_stage_counts_by_id` | `COALESCE(NULLIF(metadata->>'calor','')::INT, **5**)` — a view não tem default. E `NULLIF(...,'')` em `meeting_date` / `metrics_period_at`. | Entrada sem `calor` vale **5** aqui e **NULL** na view. Divergência de número **viva** entre o board e qualquer métrica que leia a view. |
| D4 | `fn_varredura_avisos_reuniao_proxima` | guarda `metadata->>'meeting_date' <> ''` antes do cast. | Inerte hoje; é a única que se protege do cast. |
| D5 | `get_pipeline_velocity` | **A ficha do ticket está desatualizada.** Não faz projeção inline nenhuma: lê `deals.value` desde a `20270916000010`. | — |
| D6 | ficha do ticket | Lista 13 inline; prod tem **14**, e 8 não estavam na lista: `distribute_pipe_round_robin`, `fn_capture_meeting_event`, `get_leads_not_confirmed`, `get_meeting_reminder_candidates`, `get_next_pipe_closer`, `get_pipeline_lead_ids`, `get_pipeline_page`, `get_pipeline_stage_counts_by_id`, `get_productivity_activity*`, `get_seller_activity_scores`, `is_user_responsible_in_any_pipe`, `pipeline_entries_snapshot_responsibles`, `get_analytics_pipeline_metrics`. | — |

**D3 é a única divergência de número viva.** Não foi tocada: corrigi-la move o
`calor` de todo card sem valor no board.

---

## 5. Bloqueio de gate — achado estrutural

`scripts/check-metric-antipatterns.sh` **impede** a migração mecânica das 5
funções de receita (`get_revenue_attribution`, `get_segment_benchmark`,
`get_win_loss_analysis`, `master_get_org_sales_summary`,
`get_analytics_pipeline_metrics`): reemitir o corpo num arquivo novo re-afirma
`SUM(sale_value)` fora de `sale_events`, que é a regra `ledger-revenue`.

Hoje esses corpos vivem no snapshot de baseline, que o lint isenta. Mover o
corpo, mesmo sem mudar uma vírgula da semântica, o expõe ao gate pela primeira
vez — e ele reprova, corretamente.

Não há saída barata: `allow` é proibido pelo ticket, e ler de `sale_events`
**muda o número** (o caderno é líquido de estorno; a metadata não é). Portanto
essas 5 não são fatia de refatoração — são fatia de ADR-0017, e a decisão é do
CTO.

Do outro lado, a projeção **apaga** allows: `get_funnel_health_stage_leads`
carrega 2 `metric-lint-allow` que existem só para carregar o par
`slug + tipo nativo`, e `funil_sistema` os torna desnecessários. (A função
seguiu fora do lote por outro motivo — R5, §1.2.)

---

## 6. Front — o que a próxima fatia encontra

Medido por `grep` em `src/`. Nenhum sítio foi migrado nesta fatia.

| Arquivo | Sítios | Views | Campos de dinheiro |
|---|---|---|---|
| `communication/hooks/useWhatsAppLeadIntegration.ts` | 16 | as 3 | 4 papéis, `scheduled_date` |
| `pipelines/hooks/config/usePipeMetrics.ts` | 15 | as 3 | `sale_value`, `meeting_date`, `metrics_period_at`, `product_type` |
| `leads/hooks/useLeads.ts` | 7 | as 3 | `calor`, `meeting_date`, 3 papéis |
| `analytics/hooks/useOutboundMetrics.ts` | 6 | conf+prop | `metrics_period_at` |
| `pipelines/hooks/custom/useCustomPipelines.ts` | 6 | as 3 | — |
| `engagement/hooks/useGoals.ts` | 4 | conf+prop | `sale_value` + 5 papéis |
| `engagement/hooks/useCommissions.ts` | 4 | prop | `sale_value`, `product_type`, `meeting_date` |
| `leads/components/lead-detail/hooks/useLeadDetail.ts` | 3 | as 3 | — |
| `analytics/components/dashboard/WeeklyChart.tsx` | 3 | conf+prop | `meeting_date` |
| `engagement/hooks/useCloserPerformance.ts` | 2 | conf+prop | `sale_value` + 5 campos |
| `analytics/components/dashboard/PerformanceChart.tsx` | 2 | conf+prop | `sale_value` |
| `analytics/components/dashboard/QuickStats.tsx` | 2 | conf | `is_confirmed`, `meeting_date` |
| `pipelines/components/legacy/confirmacao/ConfirmacaoCard.tsx` | 2 | conf | `is_confirmed` |
| `analytics/hooks/useDashboardMetrics.ts` | 1 | conf+prop | 6 campos |
| `pipelines/hooks/legacy/usePipeConfirmacaoByLeadId.ts` | 1 | conf | `meeting_date`, `responsible_id` |
| `pipelines/hooks/legacy/usePipePropostaByLeadId.ts` | 1 | prop | — |
| `platform/hooks/onboarding/usePrimeOnboardingProgress.ts` | 1 | prop | — |

**Total: 76 sítios em 17 arquivos.** `QuickStats.tsx` tem 0 importadores (morto);
`WeeklyChart`/`PerformanceChart` só entram pelos tabs v1, que não têm importador.

O que a fatia do front precisa, na ordem:

1. **Regenerar `types.ts`** depois do apply da `20270919000000`. Sem isso
   `Tables<"negocio_projetado">` não existe e o `tsc` recusa. Hoje
   `useCloserPerformance.ts` tipa por `Tables<"pipe_propostas">`.
2. **Trocar `.from("pipe_propostas")` por
   `.from("negocio_projetado").eq("funil_sistema","propostas")`** — os nomes de
   coluna de dinheiro são **idênticos**, então o `.select()` de cada sítio não
   muda. A exceção é `status`, que na projeção chama `stage_key`.
3. **Os 4 sítios de escrita ficam** (`useLeads.ts`,
   `useWhatsAppLeadIntegration.ts`, `useCustomPipelines.ts`,
   `stageTransition.ts`): a projeção é somente leitura, e escrever direto em
   `pipeline_entries` é fatia da SCRUM-639, não desta.
4. `useOutboundMetrics.ts` são 6 `count(head)` — o mais barato, bom primeiro
   lote.
5. Os 3 componentes mortos caem junto, para não voltarem por cópia.

---

## 7. O que **não** foi tocado

As 6 views de compat continuam de pé, com os mesmos grants e os mesmos
`INSTEAD OF`. A demolição é a SCRUM-639. Esta fatia só acrescenta uma fonte
canônica e move 6 leitoras para ela.
