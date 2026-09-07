# Checklist de demolição dos espelhos — SCRUM-639 (W6)

Critério de entregue do épico **Funil é Funil** (D5): **espelhos = 0**.

Artefatos deste ticket:

| Arquivo | O que é |
|---|---|
| `supabase/migrations/20271008000000_leitores_saem_dos_espelhos.sql` | Migra os 16 leitores SQL restantes para fontes canônicas. Tem preflight por hash e postflight global. |
| `supabase/migrations/rollback/20271008000000_leitores_saem_dos_espelhos.sql` | Rollback pareado dos 16 corpos de função capturados de produção. |
| `supabase/migrations/20271015000000_demolicao_dos_espelhos.sql` | A demolição. **Escrita, NÃO aplicada.** Três guardas abortam sozinhas se as pré-condições não estiverem satisfeitas. |
| `supabase/migrations/rollback/20271015000000_demolicao_dos_espelhos.sql` | Rollback pareado. Recria as 6 views, 18 funções de trigger, 18 triggers, 27 grants, 3 comments e os 8 wrappers — a partir dos corpos **exatos de prod capturados em 2026-09-03**. |
| `scripts/medir-leitores-espelhos.mjs` | O instrumento da janela de 7 dias. 1 execução/dia. |
| `.specs/features/funis-unificacao/medicoes/*.json` | Os snapshots. Os arquivos de 2026-09-03 e 2026-09-04 registram o período anterior ao rollout dos leitores. |

---

## 0. Estado em 2026-09-07

- SCRUM-673 e SCRUM-674 concluídas em produção: escritores do front e invariantes do banco já usam as portas canônicas.
- Código de runtime (`src/` + `supabase/functions/`) tem **zero `.from()`** para as seis relações legadas. Gate permanente: `tests/unit/espelhos-sem-leitores.test.ts`.
- Restavam **16 funções SQL** em produção. A migration `20271008000000_leitores_saem_dos_espelhos.sql` troca todas e tem preflight por MD5, postflight global, transação e rollback exato.
- Ensaio contra produção em transação com `ROLLBACK`: migration inteira compilou; oito leitores analíticos mantiveram conteúdo idêntico. `get_ranking_data` muda deliberadamente para o ledger `sale_events`; `get_next_best_actions` passa a usar âncoras canônicas.
- A migration de DROP tinha versão `20270920000000`, anterior a versões já aplicadas, e por isso nunca entrou no ledger remoto. Arquivo ainda não aplicado renomeado para `20271015000000_demolicao_dos_espelhos.sql`.
- Produção ainda não recebeu a `20271008000000`. A janela de sete dias começa no primeiro snapshot `ZERO` depois desse rollout.
- SCRUM-638 continua em `Testando`: janela operacional 2026-09-02 → 2026-09-09 e aviso externo do CTO ainda são critérios pendentes.

## 1. Pré-condições (todas, na ordem)

### 1.1 — Migrar os leitores SQL (16 funções restantes)

Entregue pela `20271008000000_leitores_saem_dos_espelhos.sql`:

- manutenção: `bulk_delete_leads`, `purge_lead`, `remove_demo_data`;
- adaptadores temporários de INSERT: `custom_pipelines_insert_fn`, `custom_pipeline_stages_insert_fn`;
- analytics: cinco `get_analytics_*`, `get_leads_by_uf`, `get_mkt_origin_metrics`, `get_uf_heatmap`;
- decisão/ordenação: `get_next_best_actions`, `get_ranking_data`;
- calendário: `trigger_google_calendar_sync`.

O preflight compara `md5(pg_get_functiondef)` dos 16 corpos capturados de produção. Drift aborta antes de qualquer troca. O postflight varre todas as funções SQL/plpgsql de `public` e exige zero `FROM/JOIN/INSERT/UPDATE/DELETE` pelos seis espelhos. Rollback pareado restaura os corpos exatos capturados antes do apply.

### 1.2 — Migrar leitores de front (`src/`)

Concluído na fatia `refactor/639-leitores-saem-dos-espelhos`:

- leituras system passam por `negocio_projetado` com `funil_sistema` e `stage_key`;
- funis custom leem `pipelines`, `pipeline_stages` e `negocio_projetado`;
- mutações continuam nas funções canônicas ou em `pipeline_entries` quando DELETE é a operação real;
- tipos públicos legados são projetados por `src/integrations/supabase/projected-pipe-types.ts` até o DROP;
- aliases de slug, query keys e campos JSON com nomes históricos não são acesso a relação e permanecem compatíveis.

Gate AST: `tests/unit/espelhos-sem-leitores.test.ts` resolve literais diretos, condicionais e constantes passadas a `.from()`, bloqueia tabelas dinâmicas `pipe_${…}` e relações legadas embutidas em `.select()`; qualquer uma das seis relações reprova CI.

### 1.3 — Migrar leitores de edge function

Concluído na mesma fatia:

- `cadastro-externo-push`: proposta por `negocio_projetado`;
- `classify-stage-roles`: leitura e escrita únicas em `pipeline_stages`, com org no write service-role;
- `_shared/workflow-trigger`: etapa custom por `pipeline_stages`;
- `_shared/action-handlers/move-stage`: entry custom por projeção e mutação pelas funções canônicas;
- `pipe-rule-dispatch`: system por `fn_entrada_sistema_atualizar`;
- `meta-webhook`: destino por `pipeline-adapter`, sem tabela construída por string.

### 1.4 — Testes

- TypeScript e build de produção verdes.
- ESLint sem erros nos arquivos alterados.
- Testes focados cobrem mapper custom, escolha de entry aberta, action handler, writeback e gate AST.
- Migration compilada contra produção dentro de transação revertida.
- Paridade de conteúdo validada para `get_analytics_{commercial,financial,overview,pipeline,utm}_metrics`, `get_mkt_origin_metrics`, `get_uf_heatmap` e `get_leads_by_uf`.
- `get_ranking_data` usa a reconciliação governada por `scripts/reconcile-ranking-997.sql`; divergências do modelo antigo precisam de finding conhecido.

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

1. Atualizar `origin/main`, rebasear a branch e resolver qualquer drift antes do merge. A branch desta fatia nasceu diretamente da `main`; nenhuma branch Omie participa.
2. Aprovar e fundir a fatia dos leitores. Aguardar o frontend da `main` ficar saudável em produção.
3. Da revisão aprovada, publicar todas as edge functions consumidoras dos módulos compartilhados alterados e aplicar `20271008000000_leitores_saem_dos_espelhos.sql` cirurgicamente. Registrar a versão `20271008000000` em `supabase_migrations.schema_migrations` dentro da mesma transação. **Não usar `supabase db push`**: o ledger remoto tem drift conhecido.
4. Rodar `node scripts/medir-leitores-espelhos.mjs --baseline` depois que frontend, Edge e SQL estiverem ativos. Esse snapshot inicia a observação; os arquivos de 3 e 4 de setembro não contam.
5. Rodar `node scripts/medir-leitores-espelhos.mjs` uma vez por dia. Exigir 7 resultados `ZERO` consecutivos, junto com os critérios operacionais da SCRUM-638.
6. **Recongelar o baseline** da migration de DROP com os `calls` do último snapshot válido (a G3 compara contra ele; baseline velho torna a guarda um carimbo).
7. Fazer ensaio abortável contra prod, **sem COMMIT**:
   ```bash
   # roda só as guardas — são leitura pura
   node scripts/prod-sql.mjs --file <trecho DO $g1$…$g1$;>
   node scripts/prod-sql.mjs --file <trecho DO $g2$…$g2$;>
   ```
   G1 tem que sair **silenciosa**. Enquanto ela listar função, não há o que discutir.
8. Aplicar `20271015000000_demolicao_dos_espelhos.sql` + escrever a linha no ledger na mesma transação.
9. Regenerar `types.ts`, remover casts e tipos de compatibilidade que perderam função e rodar a suíte completa de validação.
10. Medir paridade custom, anexar evidência à SCRUM-639 e só então fechar SCRUM-638, SCRUM-639 e o épico SCRUM-614.

Drift medido em 2026-09-03: 7 versões estão em prod e não têm arquivo nesta worktree (`20270908000000`, `20270914000010`, `20270914000020`, `20270916000010`, `20270916000020`, `20270917000010`, `20270918000020`); 2 arquivos não estão no ledger (`20270908010000`, `20270915000010`); e `20270917000000` colide entre dois arquivos. Aplicação cirúrgica com ledger explícito é obrigatória até saneamento próprio.

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
node scripts/prod-sql.mjs --file supabase/migrations/rollback/20271015000000_demolicao_dos_espelhos.sql
delete from supabase_migrations.schema_migrations where version = '20271015000000';
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
