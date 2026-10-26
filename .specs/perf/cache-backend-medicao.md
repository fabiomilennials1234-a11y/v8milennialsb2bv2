# Medição do cache por backend (onda 5 do plano de RAM do PostgREST)

Data: 19/10/2026. Projeto `jsjsmuncfkbsbzqzqhfq` (PostgreSQL 17.6, aarch64). Repo na `main` @ `be8596f67`.
**Só leitura.** Nenhuma escrita em prod, nenhuma migration, nenhum DROP. Só `SELECT`, `SET ROLE`/`RESET ROLE`, `set_config` de sessão e `DO` com `SELECT ... WHERE false`.
Documentos pai: `.specs/perf/catalogo-morto.md` (PR #2336) e `.specs/perf/ram-pool-postgrest/README.md` (branch `claude/supabase-high-ram-4bf64d`).

## Conclusão (leia primeiro)

1. **Aposentar policies e índices sobrepostos reduz ~0,4–0,7 MB por backend no caso real e ~2,4–3,4 MB no pior caso (backend que tocou o schema inteiro).** Contra ~60 MB por backend: **1% a 6%**. A onda 5 de catálogo **não vale a pena como alavanca de RAM**. Vale por higiene e segurança (lote 0), não por memória.
2. **O contexto de memória do Postgres explica pouco dos ~60 MB.** Depois de rodar as telas quentes numa sessão, `pg_backend_memory_contexts` soma **8,3 MB** (1,7 MB do backend recém-aberto + 6,6 MB das telas). Tocando **todas** as 363 tabelas de `public` e as 71 views `private.*` (teto), soma **30,5 MB**. O restante do que o SO conta como ~40–60 MB por processo **não é medível por SQL**: fragmentação do `malloc`, páginas de binário/bibliotecas, `shared_buffers` tocado (entra no RSS e não é privado), `work_mem` devolvido e não liberado, e os planos preparados do próprio PostgREST (ver "O que esta medição não vê").
3. **Dentro dos 8,3 MB do caso real, a maior parcela não é policy nem índice:** é o **cache de planos das RPCs grandes** (34%), seguido do relcache/catcache (27%). Policies + índices somam 12%.
4. **A maior alavanca encontrada na medição são as 71 views `private.*`:** consultar todas (mesmo com `permission denied` ao final, a análise e a reescrita já carregam tudo) acrescentou **+9,2 MB** (≈130 KB por view). Só pesa em backend que de fato passe por elas (RPC `SECURITY DEFINER` do `strict_lead_owner`). As telas quentes medidas **não** passam. Se alguma passar em produção, é aqui que está o MB, não nas policies.

## Método

- `execute_sql` do MCP **não mantém sessão**: `pg_backend_pid()` mudou a cada chamada (1810160 → 1810161 → 1810166 em chamadas seguidas). Sem pooler visível na conexão (porta 5432 direta, `current_user = postgres`, backends do Management API, não do PostgREST).
- Solução: **uma única chamada multi-statement**. O `pid` foi o mesmo do início ao fim (verificado: `pid0 = pid_end` em ambas as corridas, 1810250 e 1810974). Os instantâneos foram guardados em `set_config('m.aN', ...)` (GUC de sessão, não escreve nada) e o relatório saiu no `SELECT` final.
- Usuário real de teste: `admin` da org com 13.133 leads (`cc3cd000…c8`, org `4922638c…`), `SET ROLE authenticated` + `request.jwt.claims` com `sub` e `role`, conforme a memória `rls-test-as-authenticated-role`. Antes de cada leitura de `pg_backend_memory_contexts`: `RESET ROLE` (o view exige `pg_read_all_stats`).
- Baseline lido antes de tocar qualquer tabela; depois, um instantâneo após cada grupo.
- Duas corridas independentes (backends diferentes) deram 8,48 MB e 8,33 MB após as telas quentes (diferença de 1,8%). A segunda é a que está nas tabelas. A primeira serviu para achar um erro de método (ver "Limitações").
- Tentativa de ler o backend real do PostgREST com `pg_log_backend_memory_contexts(1803210)`: **negada** (`42501`). Esse caminho não existe com o papel disponível. Havia só 4 backends do PostgREST vivos no momento (pool 15 desde 14:56 UTC).

## Bytes por contexto, após cada grupo (corrida 2)

Soma de `total_bytes`, sem `GUCMemoryContext` (contém os próprios instantâneos da medição).

| Passo | Total (MB) | Δ (MB) | Observação |
|---|---:|---:|---|
| 0 baseline (backend recém-aberto) | 1,72 | | `CacheMemoryContext` 0,52 · `Timezones` 0,10 · `MessageContext` 0,15 |
| 1 `notifications` | 2,97 | +1,25 | primeira consulta paga o piso das helpers de RLS (`is_master_user`, `user_roles`, `team_members`, plano de `chat_scope`) |
| 2 `leads` (50 linhas) | 4,19 | +1,23 | 35 índices, 9 policies, regras: `leads` sozinha ≈ 168 KB nos contextos próprios + relcache/catcache |
| 3 `lead_tags` | 4,23 | +0,03 | |
| 4 `lead_phones` (`ilike '%x%'`) | 4,28 | +0,06 | |
| 5 pipeline (`get_pipeline_page` + `get_pipeline_stage_counts`) | 6,54 | +2,26 | planos das 2 RPCs: 0,54 + 0,14 + 0,14 MB e corpos PL/pgSQL |
| 6 lista multi do chat | 8,33 | +1,78 | corpo da RPC 143 KB + plano 143 KB + 9 `row security descriptor` |
| 7 `get_unread_total` + `get_unread_counts` | 8,33 | +0,00 | já aquecido pelo passo 6 |
| **Caso real (telas quentes)** | **8,33** | **+6,61** | |
| 8 as 363 tabelas de `public` (`SELECT 1 … WHERE false`) | 21,35 | +13,02 | 295 ok / 68 `permission denied` no fim; relcache já carregado nos dois casos |
| 9 as 71 views `private.*` | 30,51 | +9,17 | 0 ok / 71 `permission denied` no fim; carga já feita na análise |
| **Teto (schema inteiro tocado)** | **30,51** | | |

### Composição (MB)

| Contexto | Baseline | Caso real (passo 7) | Teto (passo 9) | O que é |
|---|---:|---:|---:|---|
| `CacheMemoryContext` (próprio) | 0,52 | 2,24 | 17,01 | entradas de relcache + catcache (colunas, procs, operadores, tipos) |
| `row security descriptor` | 0 | 0,47 | 4,05 | policies (363 contextos, uma por tabela com RLS) |
| `index info` | 0,16 | 0,55 | 2,47 | uma por índice carregado (1.424) |
| `relation rules` | 0,01 | 0,10 | 0,91 | regras de view/reescrita (77) |
| `CachedPlanQuery` + `CachedPlan` + `CachedPlanSource` | 0 | 2,86 | 2,86 | planos de SQL dentro de funções PL/pgSQL |
| `PL/pgSQL function` (corpo compilado) | 0 | 0,54 | 0,54 | 9 funções |
| `LOCALLOCK hash` + `PgStat Pending` + `Relcache by OID` + `smgr` + `TopMemoryContext` | 0,16 | 0,45 | 1,38 | estruturas por relação tocada |
| demais (`MessageContext`, `Timezones`, `ExprContext`, `Executor`, …) | 0,87 | 1,12 | 1,26 | piso fixo do backend |

Parcelas no caso real (8,33 MB): planos de RPC 34% · `CacheMemoryContext` 27% · piso fixo 13% · policies 6% · índices 7% · regras 1% · PL/pgSQL 7% · estruturas por relação 5%.
Parcelas no teto (30,51 MB): `CacheMemoryContext` 56% · policies 13% · índices 8% · planos 9% · regras 3% · PL/pgSQL 2% · demais 9%.

## Bytes por tabela, top 20 (teto, só o que o Postgres separa por tabela)

`row security descriptor` + `index info` + `relation rules`. **Não inclui** a entrada de relcache nem o catcache da tabela (ficam dentro de `CacheMemoryContext`, sem contexto próprio, portanto não atribuíveis por tabela com este view).

| # | Tabela | Policies | Índices | Policies (KB) | Índices (KB) | Regras (KB) | Total (KB) |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | `leads` | 9 | 35 | 64 | 76 | 24 | 164 |
| 2 | `lead_history` | 11 | 5 | 112 | 10 | 8 | 130 |
| 3 | `lead_custom_field_values` | 10 | 4 | 72 | 7 | 8 | 87 |
| 4 | `whatsapp_messages` | 9 | 19 | 24 | 47 | 16 | 87 |
| 5 | `campanha_dispatch_rule_steps` | 6 | 2 | 72 | 4 | 0 | 76 |
| 6 | `channel_messages` | 5 | 17 | 24 | 35 | 16 | 75 |
| 7 | `client_purchase_items` | 6 | 2 | 72 | 2 | 0 | 74 |
| 8 | `upsell_clients` | 7 | 16 | 16 | 30 | 24 | 70 |
| 9 | `scheduled_campaign_messages` | 6 | 8 | 32 | 17 | 16 | 65 |
| 10 | `lead_phones` | 5 | 8 | 40 | 17 | 8 | 65 |
| 11 | `campanha_leads` | 8 | 5 | 48 | 6 | 8 | 62 |
| 12 | `campanha_templates` | 4 | 4 | 56 | 5 | 0 | 61 |
| 13 | `workflow_executions` | 5 | 11 | 24 | 21 | 16 | 61 |
| 14 | `deals` | 5 | 12 | 16 | 27 | 16 | 59 |
| 15 | `conversations` | 8 | 10 | 24 | 17 | 16 | 57 |
| 16 | `meetings` | 6 | 10 | 24 | 17 | 16 | 57 |
| 17 | `negocio_projetado` (view) | 0 | 0 | 0 | 0 | 56 | 56 |
| 18 | `campanha_dispatch_rules` | 6 | 4 | 48 | 8 | 0 | 56 |
| 19 | `campanha_pipe_automations` | 6 | 4 | 48 | 7 | 0 | 55 |
| 20 | `sale_events` | 3 | 12 | 8 | 28 | 16 | 52 |

Leitura: **o custo por tabela é quase todo granularidade de alocação** (blocos de 8 KB por contexto), não proporcional ao nº de policies. `client_purchase_items` (6 policies) custa 72 KB e `whatsapp_messages` (9 policies) custa 24 KB. Cortar 1 policy numa tabela raramente muda o número de blocos. Para sair de um bloco, a tabela precisa perder várias policies.
As 20 maiores somam 1,5 MB dos 7,4 MB (policies + índices + regras) do teto. Nenhuma tabela passa de 170 KB nos contextos próprios.

## Custo marginal por objeto

| Objeto | Medido | Divisão |
|---|---|---|
| Policy (`row security descriptor`) | 4,05 MB ÷ 1.071 policies ≈ **3,8 KB** | médio; real em degraus de 8 KB por tabela |
| Índice (`index info`) | 2,47 MB ÷ 1.424 ≈ **1,7 KB** | só o contexto de `index info` |
| Entrada de relcache + catcache | `CacheMemoryContext` +14,8 MB (passo 7 → 9, schema inteiro) ÷ (~340 tabelas + ~1.200 índices) | **≈ 4–10 KB por relação** (não separável: mistura relcache, `pg_attribute`, `pg_proc`, operadores, tipos). Estimativa |
| View `private.*` | +9,17 MB ÷ 71 | **≈ 130 KB por view** (colunas largas, regras, dependências) |
| RPC grande (plano + corpo) | `get_whatsapp_conversation_list_multi` 143 + 143 KB · `get_pipeline_page` ~131 + 540 KB | 0,3–0,7 MB por RPC grande tocada |

## Quanto aposentar policies/índices reduz, em MB por backend

Cortes do inventário (`catalogo-morto.md`): lote 6 até −300 de 1.071 policies (28%); lotes 3+4 −203 de 1.424 índices carregados (14%).

| Corte | Caso real (telas quentes) | Teto (schema inteiro) | Conta |
|---|---:|---:|---|
| Lote 6: −300 policies | 0,13 MB | 1,13 MB | `row security descriptor` × 28% (0,47 · 4,05) |
| Lotes 3+4: −203 índices (contexto) | 0,08 MB | 0,35 MB | `index info` × 14% (0,55 · 2,47) |
| Lotes 3+4: −203 relcache de índice | 0,2–0,4 MB | 0,8–1,9 MB | 203 × 4–10 KB, só os índices em tabelas tocadas |
| **Total** | **0,4–0,7 MB** | **2,3–3,4 MB** | |
| Fração de ~60 MB | **0,7–1,2%** | **4–6%** | |

Estimativa, não medida: a medição dá os tamanhos por objeto; o corte em si não foi simulado. Ficam de fora o efeito sobre o plano de RLS embutido em planos de RPC (cada policy entra no plano de cada consulta) e o efeito do degrau de 8 KB (pode dar menos que o linear).
Objetos mortos (funções órfãs, tabelas de backup, views sem consumidor): **0 MB**, confirmado pela medição. Backend só carrega o que toca. O baseline de um backend recém-aberto, com 1.175 funções, 363 tabelas e 1.071 policies no catálogo, é 1,72 MB: o tamanho do catálogo em si não pesa.

## O que o peso de verdade sugere (onde olhar, em ordem)

1. **Planos de RPCs grandes (0,3–0,7 MB cada, 2,86 MB no caso real).** Cada backend que atende `get_pipeline_page`, `get_whatsapp_conversation_list_multi` e `get_pipeline_stage_counts*` guarda corpo compilado e planos. Encolher esses corpos (e não chamar 3 variantes de contagem na mesma tela) paga mais que 300 policies.
2. **As 71 views `private.*`: 9 MB se tocadas.** Confirmar com `pg_stat_statements` ou log quais RPCs passam por elas e com que frequência. Se o PostgREST as toca, uma RPC `DEFINER` que consulte menos views derruba o teto. Área frágil (`strict_lead_owner`).
3. **Reciclagem de backend e tamanho do pool** (hipótese 3 do plano pai): o contexto só cresce com o tempo até o teto de 8–30 MB; o resto dos 60 MB é do SO e some quando o backend morre. Pool 25→15 já fez isso.
4. **Medir o RSS privado real por backend** (fora do alcance do SQL): `smem`/`/proc/<pid>/smaps_rollup` no host, ou `AnonPages` por intervalo do painel. Sem isso o "60 MB" não decompõe em contexto vs fragmentação vs libs.

## O que esta medição não vê (limitações)

- **Não é um backend do PostgREST.** Conexão do Management API, papel `postgres` com `SET ROLE authenticated`. PostgREST usa **statements preparados por conexão** (um `CachedPlanSource` por texto de consulta distinto); aqui rodei SQL simples/`DO`. Esse custo existe nos backends reais e não foi medido. A leitura mais honesta: os 8,3 MB são **piso** do caso real, não o valor.
- **Só contextos `palloc`.** Não inclui `malloc` não devolvido ao SO, binário, bibliotecas, memória compartilhada tocada.
- **Telas cobertas:** notifications, leads, lead_tags, lead_phones, pipeline, lista multi do chat, unread. Fora: dashboards/métricas, campanhas, copilot, workflows, agenda, billing. O caso real de um backend com 3–20 h de vida (plano pai) está entre 8,3 MB e 30,5 MB, mais o que não é contexto.
- **Passo 8 contou 68 tabelas com erro ao final** (`permission denied` para `authenticated`); a análise já havia carregado relcache e policies de todas (363 `row security descriptor`), então o teto vale. O passo 9 idem para as 71 views.
- **Corrida 1 teve um erro de método** (comparação de instantâneos duplicava linhas ao agrupar por nome+ident; o campo `grown_per_step` saiu errado e foi descartado). Os totais de contexto não dependiam disso e bateram com a corrida 2 (8,48 vs 8,33 MB).
- Um usuário, uma org (13 mil leads). Org maior não muda o tamanho do catálogo cacheado; muda o plano.

## Reprodução

Script: uma chamada `execute_sql` única, na ordem `reset role` → instantâneo 0 → `set_config('request.jwt.claims', …)` → para cada grupo: `set role authenticated` + `DO` com `PERFORM` e `EXCEPTION WHEN OTHERS` → `reset role` → instantâneo (`jsonb_object_agg(name, sum(total_bytes))` guardado em `set_config('m.aN', …, false)`) → passos 8 e 9 (`DO` com `EXECUTE 'select 1 from <rel> where false'` por relação) → `SELECT` final que lê os GUCs. Sem escrita.
