# Checklist de demolição dos espelhos — SCRUM-639 (W6)

Critério de entregue do épico **Funil é Funil** (D5): **espelhos = 0**.

Artefatos deste ticket:

| Arquivo | O que é |
|---|---|
| `supabase/migrations/20270920000000_demolicao_dos_espelhos.sql` | A demolição. **Escrita, NÃO aplicada.** Três guardas abortam sozinhas se as pré-condições não estiverem satisfeitas. |
| `supabase/migrations/rollback/20270920000000_demolicao_dos_espelhos.sql` | Rollback pareado. Recria as 6 views, 18 funções de trigger, 18 triggers, 27 grants, 3 comments e os 8 wrappers — a partir dos corpos **exatos de prod capturados em 2026-09-03**. |
| `scripts/medir-leitores-espelhos.mjs` | O instrumento da janela de 7 dias. 1 execução/dia. |
| `.specs/features/funis-unificacao/medicoes/*.json` | Os snapshots. O de `2026-09-03.json` é o baseline. |

---

## 0. Estado medido em 2026-09-03 — o DROP **NÃO** está liberado

- **32 funções SQL vivas em prod** ainda leem/escrevem pelos 6 espelhos (G1 reprova, testada por ensaio abortável contra prod nesta data).
- **5 das 6 views receberam leitura do front (`authenticated`) numa janela de 4 minutos** — `pipe_whatsapp`, `pipe_confirmacao`, `pipe_propostas`, `custom_pipelines`, `custom_pipeline_stages`. Só `custom_pipe_entries` ficou em zero nesse recorte, e 4 minutos não são prova de silêncio.
- **~25 sítios de front vivos** e **4 sítios de edge function vivos** ainda passam pelos espelhos.

A janela de 7 dias **ainda não começou**. Ela começa no primeiro dia em que `medir-leitores-espelhos.mjs` devolver `VEREDITO DO DIA: ZERO`.

---

## 1. Pré-condições (todas, na ordem)

### 1.1 — Migrar os leitores SQL (32 funções)

Ordem sugerida, por risco decrescente de quebrar dinheiro:

| Grupo | Funções | Caminho canônico |
|---|---|---|
| **Métricas de dinheiro** (13) | `get_analytics_{overview,commercial,financial,engagement,pipeline,utm}_metrics`, `get_dashboard_metrics`, `get_ranking_data`, `get_product_ranking`, `get_funnel_health`, `get_next_best_actions`, `get_uf_heatmap`, `get_leads_by_uf`, `get_mkt_origin_metrics` | `pipeline_entries pe JOIN pipelines p ON p.id = pe.pipeline_id` + `pipeline_stages.stage_role` para o papel da etapa. `sale_value` sai de `pe.metadata->>'sale_value'` **ou** do ledger `sale_events` (ADR-0017) — decidir por função, não por atacado. |
| **Escrita / ciclo de vida** (8) | `abrir_negocio`, `create_lead_with_pipe`, `create_lead_from_social_conversation`, `import_lead_into_custom_pipeline`, `sync_responsible_from_lead_to_pipes`, `bulk_delete_leads`, `purge_lead`, `remove_demo_data` | INSERT/UPDATE/DELETE direto em `pipeline_entries`, resolvendo o funil por `pipelines.slug`/`id` em vez do nome da view. |
| **Agenda / calendário** (3) | `get_agenda_events`, `get_agenda_events_scoped`, `trigger_google_calendar_sync` | `pe.metadata->>'meeting_date'` sobre `pipeline_entries` do funil `confirmacao`. |
| **Auxiliares** (8) | `_stage_is_final`, `_stage_key_label`, `metric_stage_role`, `fn_log_pipeline_stage_change_history`, `fn_auto_assign_lead_default_pipe`, `get_all_funnels_lead_ids`, `lead_excluded_from_metrics`, `delete_pipeline` | Todas leem `custom_pipeline_stages` ou `custom_pipe_entries`: trocar por `pipeline_stages` / `pipeline_entries` com `JOIN pipelines`. As três primeiras são as mais baratas (leitura de 1 coluna). |

**Esforço e risco — as métricas de dinheiro são a fatia cara.** As views projetam de `metadata` colunas que o caminho canônico não tem com esse nome: `sale_value`, `sdr_id`, `closer_id`, `responsible_id`, `pre_sale_responsible_id`, `sale_responsible_id`, `is_confirmed`, `metrics_period_at`, `loss_reason_id`, `product_id`, `calor`. Reescrever cada `SELECT sale_value FROM pipe_propostas` como `(pe.metadata->>'sale_value')::numeric` é mecânico; o que **não** é mecânico é que a view faz o cast e o `COALESCE` num lugar só, e 13 funções passam a fazer cada uma o seu. **Não reescrever à mão uma por uma.** A alternativa barata e reversível: uma função `fn_pipe_entry_money(pe)` (ou um CTE padrão) que centralize a projeção, e as 13 funções passam a chamá-la. Risco se feito na marra: divergência silenciosa de número entre dashboards — que é exatamente o defeito-raiz da auditoria de métricas de 2026-07 (ADR-0017). **Não fazer neste ticket.**

### 1.2 — Migrar os leitores de front (`src/`)

**Vivos, precisam migrar antes do DROP:**

| Arquivo | Views | O que faz |
|---|---|---|
| `src/modules/engagement/hooks/useGoals.ts:177-207` | `pipe_propostas`, `pipe_confirmacao` | **Leitor confirmado por medição** (delta > 0 na janela de 4 min). Metas do mês: `sale_value` + trio de atribuição. |
| `src/modules/engagement/hooks/useCloserPerformance.ts:57,78` | `pipe_propostas`, `pipe_confirmacao` | `usePerfPipePropostas` / `usePerfPipeConfirmacao` — org inteira, `refetchInterval` ligado. Alimenta a TV. |
| `src/modules/engagement/hooks/useCommissions.ts:269,278` | `pipe_propostas` | Comissão por vendedor. Dinheiro. |
| `src/modules/pipelines/hooks/custom/useCustomPipelines.ts` (~20 sítios) | as 4 `custom_*` + os 3 `pipe_*` | CRUD inteiro dos funis custom, incluindo `insert`/`update`/`delete` pelas views (passa pelos INSTEAD OF). O maior sítio único. |
| `src/modules/pipelines/lib/stageTransition.ts:34,90,94` | `custom_pipe_entries` | Move de etapa. |
| `src/modules/pipelines/hooks/config/usePipeMetrics.ts` (~15 sítios) | `pipe_propostas`, `pipe_confirmacao`, `pipe_whatsapp` | Métricas do board. |
| `src/modules/leads/components/lead-detail/hooks/useLeadDetail.ts:100-104` | as 3 `pipe_*` + `custom_pipe_entries` | 4 queries paralelas por lead aberto. |
| `src/modules/leads/hooks/useLeads.ts:294-321` | as 3 `pipe_*` | Propaga responsável para os pipes. **Escrita.** |
| `src/modules/leads/components/lead-detail/modal/pipes/useCrossPipeMove.ts:73` | `custom_pipe_entries` | Move entre funis. |
| `src/modules/leads/hooks/useLeadAllPipelines.ts:94` | `custom_pipeline_stages` | |
| `src/modules/communication/hooks/useWhatsAppLeadIntegration.ts` (~15 sítios) | as 3 `pipe_*` + `custom_pipe_entries` | Cria lead + entry a partir do chat. **Escrita.** |
| `src/modules/analytics/hooks/useDashboardMetrics.ts:405` | `pipe_propostas` | |
| `src/modules/analytics/hooks/useOutboundMetrics.ts:78-103` | `pipe_confirmacao`, `pipe_propostas` | 6 `count(head)`. |
| `src/modules/pipelines/hooks/legacy/usePipe{Proposta,Confirmacao}ByLeadId.ts` | `pipe_propostas`, `pipe_confirmacao` | Ligados no `PipeOpsProvider`. |
| `src/modules/pipelines/components/legacy/confirmacao/ConfirmacaoCard.tsx:204,220` | `pipe_confirmacao` | |
| `src/modules/platform/hooks/onboarding/usePrimeOnboardingProgress.ts:121` | `pipe_propostas` | |

**Mortos — não bloqueiam, mas devem cair junto para não voltarem por cópia:**
`src/modules/analytics/components/dashboard/QuickStats.tsx` (0 importadores), `WeeklyChart.tsx` e `PerformanceChart.tsx` (importados só por `TabInteligencia.tsx` / `TabPerformance.tsx`, que são os tabs **v1** e não têm importador nenhum — `pages/Dashboard.tsx` usa os `*V2`).

**Falso positivo, não mexer:** `src/modules/campaigns/hooks/useCampanhas.ts:16,1399-1401` usa `'pipe_whatsapp' | 'pipe_confirmacao' | 'pipe_propostas'` como **chave de alias de slug** (`TargetPipe`), não como tabela. Mesma natureza do `LEGACY_SLUG_ALIASES` de `supabase/functions/_shared/pipeline-adapter.ts`, já registrado como exceção deliberada no gate `tests/unit/pipe-whatsapp-espelho-sem-leitores.test.ts`.

**Já morto, conferido:** `SYSTEM_PIPE_TABLE` do tool-executor do copilot-v2 — removido na SCRUM-628; `move_lead_stage` escreve pelo `pipeline-adapter`. `useTVDashboardData.ts` não toca as views diretamente (chega nelas via `useGoals`/`useCloserPerformance`).

### 1.3 — Migrar os leitores de edge function

| Arquivo | View | Nota |
|---|---|---|
| `supabase/functions/cadastro-externo-push/index.ts:111` | `pipe_propostas` | Resolve a org **a partir da proposta**. Trocar por `pipeline_entries` + `pipelines.slug='propostas'`. |
| `supabase/functions/_shared/action-handlers/move-stage.ts:95,345,349,368,372` | `custom_pipe_entries` | R+W. Usa embed do PostgREST (`stage:custom_pipeline_stages(stage_role)`) — o embed some junto com a view, não só a tabela. |
| `supabase/functions/classify-stage-roles/index.ts:196` | `custom_pipeline_stages` | R+W de `stage_role`/`suggested_stage_role` pelo INSTEAD OF. |
| `supabase/functions/_shared/workflow-trigger.ts:104` | `custom_pipeline_stages` | Lê `stage_role` da etapa de destino. |

### 1.4 — Testes

`tests/remote/setup-remote.ts:79-82` e as suítes `tests/integration/{pipe-confirmacao-propostas,pipe-stage-move,bulk-add-to-custom-pipe,lead-import,get-filtered-lead-ids-conditions,rls-responsibility,master-first-class}.test.ts` referenciam as views. Não bloqueiam prod, mas viram vermelho no dia do DROP. Migrar junto com o código que exercitam.

### 1.5 — Fusões de hook pendentes

- `usePaginatedFunil` × `usePaginatedPipeline` — hoje `usePaginatedFunil` importa `MAX_STAGES`, `PAGE_SIZE`, `SEARCH_DEBOUNCE_MS`, `sharedRpcFilterParams`, `PaginatedFilters`, `StageData` de `usePaginatedPipeline`. Já compartilham o bloco de filtros; falta o board.
- `useFunilStages` × `useStagesDoFunil` — **já fundido pela metade**: `useStagesDoFunil` é um *selector* sobre `useFunilStages` (que vive em `usePaginatedFunil.ts:36`). Falta só mover `useFunilStages` para arquivo próprio.

A fusão importa aqui porque `usePaginatedPipeline` é o último chamador vivo de `get_pipeline_stage_counts(p_pipeline_slug…)` — o wrapper por slug que este DROP **não** derruba justamente por causa dele.

### 1.6 — Sete dias de leitura zero

```bash
node scripts/medir-leitores-espelhos.mjs   # 1×/dia, commitando o JSON
```

Sai `ZERO` (conta o dia), `LEITOR VIVO` (**zera a janela**) ou `EVICTED — dia inválido` (o contador de pgss regrediu por eviction LRU: o dia **não conta**, e não é aprovação).

Complemento já existente: `.specs/features/funis-unificacao/plano-observacao-7-dias.md` (SCRUM-638) cobre lead-webhook, workflows e disparo. Rodar os dois.

### 1.7 — Regenerar `types.ts`

```bash
supabase gen types typescript --project-id jsjsmuncfkbsbzqzqhfq > src/integrations/supabase/types.ts
```

**Só DEPOIS do apply.** Antes, as views ainda existem e o arquivo continua igual. `types.ts` cita as views em 12+ pontos; o `tsc` só acusa os sítios sobrantes depois da regeneração — é essa passada que produz a lista final do que ficou para trás.

---

## 2. Ordem de aplicação

1. `git pull` na `main`. **Conferir o drift do ledger** (medido em 2026-09-03): 7 versões estão em prod e **não** têm arquivo nesta worktree (`20270908000000`, `20270914000010`, `20270914000020`, `20270916000010`, `20270916000020`, `20270917000010`, `20270918000020`) e 2 arquivos não estão no ledger (`20270908010000`, `20270915000010`). Além disso, **`20270917000000` colide**: dois arquivos com o mesmo timestamp (`campanha_e_disparo_por_pipeline_id` e `org_plural_nas_39_tabelas_restantes`), e o ledger tem só uma entrada — o segundo **nunca rodou**. `supabase db push` é inutilizável neste estado; aplicar cirurgicamente, com ledger explícito.
2. Rodar `node scripts/medir-leitores-espelhos.mjs` e confirmar 7 `ZERO` consecutivos nos JSONs de `medicoes/`.
3. **Recongelar o baseline** da migration com os `calls` do último snapshot (a G3 compara contra ele; baseline velho torna a guarda um carimbo).
4. Ensaio abortável contra prod, **sem COMMIT**:
   ```bash
   # roda só as guardas — são leitura pura
   node scripts/prod-sql.mjs --file <trecho DO $g1$…$g1$;>
   node scripts/prod-sql.mjs --file <trecho DO $g2$…$g2$;>
   ```
   G1 tem que sair **silenciosa**. Enquanto ela listar função, não há o que discutir.
5. Aplicar a migration + escrever a linha no `supabase_migrations.schema_migrations` (versão `20270920000000`) na mesma transação.
6. Regenerar `types.ts`, rodar `npm run typecheck:ratchet` e `npm run lint`.
7. Redeployar as 4 edge functions do §1.3 **antes** do merge do front — a ordem inversa quebra o WhatsApp inbound.

## 3. Verificação pós-apply

```sql
-- espelhos = 0
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in
 ('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
  'custom_pipe_entries','custom_pipelines','custom_pipeline_stages');           -- 0

-- funções de trigger órfãs = 0
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname ~
 '^(pipe_whatsapp|pipe_confirmacao|pipe_propostas|custom_pipe_entries|custom_pipelines|custom_pipeline_stages)_(insert|update|delete)_fn$';  -- 0

-- nenhuma função ficou apontando para o vazio
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 join pg_language l on l.oid=p.prolang
 where n.nspname='public' and p.prokind='f' and l.lanname in ('plpgsql','sql')
   and pg_get_functiondef(p.oid) ~
   '\m(pipe_whatsapp|pipe_confirmacao|pipe_propostas|custom_pipe_entries|custom_pipelines|custom_pipeline_stages)\M'; -- vazio
```

Fumaça de produto, no navegador (o `tsc` verde não prova tela viva — a tela branca de hook fora do Router passou por todos os gates): abrir `/funil/:slug` de uma org com funil custom, mover um card, abrir um lead, abrir o Dashboard e a Performance, e mandar 1 mensagem no chat que crie lead.

## 4. Rollback

```bash
node scripts/prod-sql.mjs --file supabase/migrations/rollback/20270920000000_demolicao_dos_espelhos.sql
delete from supabase_migrations.schema_migrations where version = '20270920000000';
```

O arquivo recria tudo **incluindo os grants** — um `DROP`+`CREATE` de função devolve `EXECUTE` para `PUBLIC`/`anon` se os grants não forem reaplicados, e as 27 linhas de `GRANT` e as `GRANT EXECUTE` dos wrappers estão lá por isso. Depois de rodar, conferir:

```sql
select relname, relacl from pg_class
 where relname in ('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
                   'custom_pipe_entries','custom_pipelines','custom_pipeline_stages');
```

---

## 5. O que este ticket decidiu **não** derrubar

| Objeto | Medição (prod, 2026-09-03) | Veredito |
|---|---|---|
| `pipeline_entries.stage_key` | **88 funções** de prod citam o token; as 6 views a projetam como `status` | Fica. Ticket próprio: migrar para `stage_id` + `pipeline_stages.stage_role`. |
| `leads.pipe_whatsapp` | **5 funções** vivas tocam a coluna: `get_leads_no_response_from_lead` e `get_leads_team_no_response` (predicado de funil), `get_pending_meta_conversion_signals` (`= 'compareceu'`, o sinal que vai para a Meta), `delete_pipeline` (zera), `sync_pipeline_entry_to_lead_pipe_whatsapp` (escreve) | Fica. É o SCRUM-222. As edge functions já estão limpas e travadas por gate; falta o lado SQL. |
| `get_pipeline_stage_counts(p_pipeline_slug…)` | chamado por `usePaginatedPipeline.ts:298` | Fica até a fusão do §1.5. |
| `get_filtered_lead_ids` / `get_stage_lead_ids` (`p_pipeline_type`) | `useFilteredLeadIds.ts:99` / `useStageLeadIds.ts:26` | Ficam. Assinam por type; trocar é fatia de front. |
| `bulk_move_stage(p_target_pipe…)` | `useBulkActions.ts:18` | Fica. |
| `get_funnel_conversion` / `get_pipeline_velocity` / `get_sales_cycle_analysis` (`p_pipeline_type`) | `useAnalytics.ts:54,72,104` | Ficam. |

## 6. Fontes da medição e o que cada uma não enxerga

| Fonte | O que deu | Limite |
|---|---|---|
| `pg_stat_statements` 1.11 | 6/6 views com statements; delta > 0 em 5/6 numa janela de 4 min | Não tem `last_call` (é 1.12+): recência só por **diferença** entre snapshots. Está em **4880/5000** entradas e evicta por LRU — presença prova chamada, **ausência não prova silêncio**. `track=top`: statement aninhado dentro de função **não** aparece, então leitura feita por RPC some da contagem por nome de view. |
| `pg_get_functiondef` sobre `pg_proc` | 32 funções vivas lendo/escrevendo pelas views | Texto, não dependência: pega comentário e literal junto (por isso o filtro por `FROM/JOIN/INSERT INTO/UPDATE/DELETE FROM`). Em compensação é a **única** fonte que enxerga o que `pg_depend` não vê — corpo de plpgsql. |
| `pg_depend` / `pg_rewrite` | 0 views/rules dependentes | Só enxerga view-sobre-view e rule. **Cego** para plpgsql, para o front e para as edge functions. |
| Inventário de código (`git grep` + grafo de import a partir de `src/main.tsx`) | ~25 sítios de front vivos, 3 mortos, 4 edge functions | Não prova execução, só alcance. Um sítio vivo pode nunca rodar; um sítio "morto" volta com um import. |
| `runtime_logs` | **descartada** | 381.726 linhas em 7 dias, **0** mencionando qualquer um dos 6 nomes. Registra ação de negócio, não nome de relação. |
| `pg_stat_user_tables` / `pg_statio_user_tables` | **inaplicável** | Não cobrem views. As leituras aparecem creditadas em `pipeline_entries`/`pipelines`/`pipeline_stages`, sem distinguir quem chegou pela view. |
