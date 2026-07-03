# Auditoria do Sistema de Métricas — Torque CRM

**Data:** 2026-07-02
**Método:** auditoria multi-agente (8 leitores de domínio → síntese de cross-consistência → verificação adversária finding-a-finding contra o código → benchmark world-class em 3 lentes → crítico de completude). 41 agentes, 3.58M tokens, 132 métricas catalogadas.
**Escopo:** RPCs de analytics/ranking/funil/produtividade em `supabase/migrations`, hooks em `src/modules/analytics|engagement`, componentes de dashboard/TV. Sempre a versão **mais recente** de cada RPC (muitas foram redefinidas 4–18×).

---

## 1. Veredito

Tua intuição está certa e é pior do que parece. **Os números não batem por design, não por bug pontual.** 24 inconsistências foram confirmadas linha-a-linha contra o código (2 descartadas na verificação por não se sustentarem). A causa não é uma conta errada isolada — é a **ausência de uma camada semântica**: cada métrica é reimplementada inline em plpgsql, RPC por RPC, tela por tela, e essas implementações divergem em âncora temporal, chave de atribuição, definição de etapa e escopo de pipeline.

O sintoma que denuncia a fundação: `get_ranking_data` foi corrigida ~6×, `get_dashboard_metrics` ~18×. **Cada correção reabre outra divergência** porque não existe um lugar único onde a métrica é definida. Isso é entropia estrutural, não dívida técnica pontual.

Um dado que resume tudo: **0 materialized views, 0 fact/rollup tables, 0 camada semântica** (dbt/Cube/Looker). A mesma definição de "venda do período" está literalmente copiada em `get_dashboard_metrics` e `get_productivity_activity`. Duas cópias = duas verdades.

---

## 2. As 6 causas-raiz estruturais

Todas as 24 inconsistências reduzem a estas seis. Corrigir sintoma-a-sintoma é enxugar gelo; a alavanca está aqui.

### R1 — Não existe log imutável de transição de etapa (o funil é estado mutável)
O estado de etapa vive em `pipeline_entries.stage_key`, que é **mutável e retroage** quando o card sai do estágio. O único "histórico" é `lead_history.action='stage_changed'` com o alvo num JSONB solto (`metadata->>'to_stage'`), semi-estruturado, sem `stage_entered_at`, sem pares enter/exit. Só reunião tem event-sourcing de verdade (`meeting_events`, ADR-0007).
**Consequência:** é impossível responder deterministicamente "quantos leads da coorte de maio já passaram por reunião até o fim de maio" — a base muda embaixo. **É a causa-raiz de metade dos findings** (retroação, no-show status-based, ciclo mal-rotulado, funil que não fecha).

### R2 — `stage_key` é string editável pelo usuário, hardcoded em ~15 RPCs, sem integridade referencial
373 ocorrências de `stage_key` hardcoded em 53 migrations. **Nenhum FK/CHECK/trigger** liga `pipeline_entries.stage_key` a `pipeline_stages.stage_key`. As strings (`'vendido'`, `'compareceu'`, `'perdido'`) são um **contrato implícito não-enforçado** sobre dado 100% editável no kanban. Os guards antigos (ENUMs, `trg_validate_pipe_*_status`) foram removidos de propósito para permitir stages custom.
**Consequência:** admin desativa a coluna "vendido" e cria "Ganho" → funil de vendas, receita, ticket e ranking **zeram do dia para a noite, sem erro nenhum**. Já produziu o bug real `confirmada_no_dia` (typo vs a key real `confirmacao_no_dia`).

### R3 — Custom pipelines (`type != 'system'`) são invisíveis a praticamente toda métrica
O predicado `pip.type = 'system'` está gravado nas views de compat e inline em quase toda RPC. Lead que vive só num pipeline customizado contribui **0** para funil, receita, reunião, ranking, score, comissão e benchmark.
**Consequência:** o pitch do produto é "CRM flexível", mas **a org que customiza o funil vê o dashboard vazio**. Pior gap de produto da auditoria. E no `get_segment_benchmark` isso vaza **cross-org**: peers que vendem em pipeline custom subestimam o mercado inteiro na comparação.

### R4 — Zoo de âncoras temporais + fallback `updated_at` não-determinístico
"Venda do período" tem **4–6 âncoras** diferentes conforme a tela: `metrics_period_at`, `created_at`, `closed_at`, `occurred_at`, `meeting_date`, e o fallback `updated_at`. Esse último é venenoso: **um toque de edição no card muda `updated_at` e a venda "pula" de mês**. Comercial ancora em `created_at`, Financeiro em `closed_at`, Produtividade em `MIN(lead_history.created_at)`.
**Consequência:** a mesma venda cai em meses diferentes conforme a aba. **Impossível fechar o mês.**

### R5 — Atribuição por membro usa 5+ chaves inconsistentes, sem snapshot no evento
`sdr_id` (83 arqs), `closer_id` (84), `responsible_id` (54), `assigned_to` (39), `sale_responsible_id` (25), `pre_sale_responsible_id`. Um único `memberId` do filtro (`useAnalyticsFilters`) é casado contra colunas **diferentes por aba**. Venda com a chave específica NULL conta no total global mas em nenhum membro.
**Consequência:** **`SUM(por membro) ≤ total`** — somar o ranking não dá o card de topo. E o pior: venda creditada por `closer_id` aparece no pódio mas **não gera comissão** (comissão lê `sale_responsible_id` puro). Dinheiro pago ≠ número na tela.

### R6 — Dupla fonte da verdade sem SoT declarada (nenhuma reconcilia)
`meeting_events` (event-sourced, correto) vs `pipe_confirmacao.status` (status-based, mutável) coexistem **na mesma tela da TV**. Comissão tem ledger persistido (`commissions`) **vs** cálculo on-the-fly (`useCommissionSummary`), sem trigger que gere o ledger ao vender. A TV recalcula ticket (3 formas) e conversão (4 formas) client-side. O DB já migrou no-show para event-sourced, mas a lógica status-based **sobrevive intacta no frontend**.

---

## 3. As 24 inconsistências confirmadas (priorizadas)

Verificação adversária: cada uma foi atacada por um agente cético tentando **refutá-la** contra o código. Só entrou como CONFIRMED com evidência arquivo:linha. Prioridade P0 (dinheiro/decisão errada agora) → P2.

### 🔴 P0 — Crítico (número que o gestor usa pra decidir está errado ou some dinheiro)

| # | Finding | Sintoma visível | Raiz | Evidência |
|---|---------|-----------------|------|-----------|
| 1 | **Dois sistemas de reunião nunca reconciliam** | "Reuniões realizadas" mostra números diferentes entre Comando, Analytics, TV, Metas e Pipe Confirmação — pra mesma org/período. Na TV, KPI "Reuniões" e funil "Comparecidas" aparecem lado a lado com valores distintos | R6 | `20261125000001:76-83` (event-sourced) vs `20261114000011:135,1509,2439` (status-based); `useTVDashboardData.ts:77` vs `useTVKPIs.ts:42` na mesma tela |
| 2 | **"Vendas do período": 4+ âncoras temporais** | Receita e nº de vendas não batem entre Comercial, Financeiro, Pipes/Funis, Comando e Produtividade. Mesmo vendedor mostra receita diferente entre Comercial e Financeiro | R4 | `20261125000001:130-131` (COALESCE metrics_period_at,closed_at,updated_at) vs `20261114000011:706-707` (só closed_at) vs `:145` Comercial (created_at) |
| 3 | **Atribuição por membro: 5+ chaves → soma ≠ total** | Somar o ranking de vendedores não dá o total dos cards de topo. Vendedor vê a venda no pódio mas **não recebe comissão** dela | R5 | `20261114000011:122,137,154,215-230`; comissão `useCommissions.ts:187,284` (chave pura) vs pódio COALESCE `20261125000001:291` |
| 4 | **Custom pipelines 100% invisíveis** | Org que opera vendas em pipeline customizado vê dashboard comercial, ranking, metas e comissões **zerados** — o trabalho existe no kanban mas não aparece em métrica nenhuma | R3 | `type='system'` em `20260983000000`, `20261114000011:2440`, `20261127000000:56`, `20261130000000:108` |

### 🟠 P1 — Alto (bug de fórmula ou quebra silenciosa)

| # | Finding | Sintoma | Raiz | Evidência |
|---|---------|---------|------|-----------|
| 5 | **Renomear "vendido" zera receita sem erro** | Admin renomeia/desativa a coluna "vendido" (ex: "Ganho") e funil, receita, ticket e ranking zeram silenciosamente | R2 | `20261114000011:1532,1662-1668`; `pipeline_entries.stage_key` TEXT sem FK `20260941000000:66` |
| 6 | **BUG: transição "Reunião→Proposta" é sempre 100%** | Na aba Pipes/Funis a etapa Reunião→Proposta mostra 100% em todo mês/org — mascara o gargalo real do funil | fórmula | `fix_analytics_consistency.sql:1340,1405` divide `attended_count/attended_count` (copy-paste) |
| 7 | **Automação de confirmação usa stage morto (typo)** | Leads já confirmados no dia continuam recebendo alerta de confirmação indevido | R2 | `20260982000000:1106` exclui `'confirmada_no_dia'` mas a key real é `'confirmacao_no_dia'` — cláusula é no-op |
| 8 | **`metric_type` decide sozinho o bucket do ranking** | SDR/vendedor mal-configurado (metric_type errado/NULL) some do pódio ou aparece com 0; muda a cada deploy | R5 | `20261125000001:305,357`; DEFAULT 'meetings' vs fallback 'sales'; corrigido ~6× |
| 9 | **Tipos de meta desalinhados (UI/RPC/lib) + bônus OTE de 3ª fórmula** | Gestor cadastra meta e a barra fica 0. Bônus OTE (dinheiro) deriva de % diferente do pódio. Meta de reuniões marcadas sempre 0 | R6 | `GestaoMetas.tsx:48-54` vs RPC `20261125000001:310,364` vs `goal-progress.ts:42` |
| 10 | **"Marcadas" e "comparecidas" com âncoras opostas** | Taxa de comparecimento (comparecidas/marcadas) às vezes **passa de 100%** ou oscila sem sentido entre meses | R4 | `20261125000001:71` (occurred_at) vs `:80-81` (meeting_date); `Metas.tsx:53-54` divide as duas coortes |
| 11 | **Comissão: dupla fonte sem trigger de ledger** | Card de earnings (dinâmico) ≠ tabela de histórico (ledger); histórico pode estar vazio mesmo com vendas fechadas | R6 | ledger `commissions` vs `useCommissions.ts:132-135`; nenhum trigger gera linha ao vender |

### 🟡 P2 — Médio (métrica secundária incorreta ou enganosa)

| # | Finding | Sintoma | Raiz |
|---|---------|---------|------|
| 12 | `get_pipeline_velocity` ignora `p_pipeline_type` (seletor no-op), win_rate cruza janelas, ticket ÷100 assume centavos | Trocar o pipe no card de Velocidade não muda nada; win_rate errado; ticket pode aparecer 100× menor | fórmula |
| 13 | `get_sales_cycle_analysis` mistura moves de todos os pipes por lead, rotula transições erradas, ignora vendas manuais | Ciclo de vendas mostra tempos/transições sem sentido | R1 |
| 14 | `get_funnel_health` conta "ever-reached" sem corte temporal contra coorte por `created_at` | Saúde do Funil não bate com Produtividade/Dashboard; conversão alta demais | R1/R4 |
| 15 | Produtividade dropa `held` com `meeting_date` NULL; Dashboard faz COALESCE | Card "Reuniões Realizadas" da Produtividade < o do Comando pro mesmo período | R4 |
| 16 | TV trunca 500 entries/pipe em alguns blocos, não em outros | Numa org grande, funil/tickets/conversão da TV < blocos SDR/Closer da mesma TV; piora com o volume | fórmula |
| 17 | Dashboard Outbound é org-wide mas se apresenta como pessoal; alimenta badges | Cada vendedor vê números da org como se fossem dele e desbloqueia conquistas indevidas | R5 |
| 18 | TV recalcula ticket (3×) e conversão (4×) client-side em vez da RPC canônica | Ticket e conversão diferentes entre KPIs rotativos, funil e blocos da própria TV | R6 |
| 19 | Qualidade por Origem / CAC: numerador (vendas) sem bound de data contra denominador (leads) do período | Taxas de conversão irreais; benchmark de segmento distorcido | R4 |
| 20 | `weighted_forecast` usa probabilidades hardcoded presas a stage_keys system; deals em `proposta_enviada` somem | Previsão ponderada subestima o pipeline; orgs que renomeiam stages perdem forecast | R2/R3 |
| 21 | `ConfirmacaoStats.tsx` (gate meeting_date) vs `computeConfirmacaoStats` (sem gate) no mesmo módulo | Cards Compareceram/Taxa/No-Show diferentes dependendo do componente, na mesma página | R6 |
| 22 | `get_segment_benchmark` é SECURITY DEFINER **sem** `assert_org_access` | Risco de vazamento cross-tenant no benchmark (assimetria vs as 5 RPCs já guardadas) | segurança |
| 23 | KPIs da TV enganosos: `base_ativa` hardcoded 0; "Respostas" conta o stage `abordado`, não replies reais | Quem configura "Base Ativa" vê sempre 0; "Respostas" não bate com Taxa de Resposta do Outbound | fórmula |
| 24 | Split A/B totalmente isolado; RLS inline `SELECT FROM team_members` (anti-pattern do próprio CLAUDE.md) | Métricas de Split A/B não conciliam com nada; RLS inline arrisca recursão no Realtime | R6/segurança |

**Plausíveis (não confirmadas por falha de conexão na verificação, mas com forte evidência):** no-show tem 4–6 definições vivas (2 na mesma TV; frontend usa a definição que o DB aposentou); "Análise de Coorte" agrupa por mês de venda mas a UI diz "mês de criação", e retenção é aritmética de `contract_duration` (frequentemente NULL), não recompra real.

---

## 4. Benchmark: como CRMs world-class resolvem isto

A boa notícia: o Torque **já tem o embrião da solução certa** — `meeting_events` (ADR-0007) é event-sourcing exemplar (append-only, snapshot imutável de atribuição, funnel-agnostic, com backfill). O problema é que é uma **ilha**. A arquitetura-alvo é generalizar esse padrão que já funciona.

### Etapa como fato temporal, não estado
- **Salesforce** grava `OpportunityHistory`: 1 linha imutável append-only a cada mudança de `StageName`, com valor antigo/novo/timestamp. Reports leem o **log**, nunca o estado atual.
- **HubSpot** mantém `hs_date_entered_<stage>` por etapa por deal.
- **Gong/Clari** reconstroem o "deal flow" inteiro a partir dos eventos de mudança.
- → **Torque:** criar `pipeline_stage_events` (append-only, populada por trigger em `pipeline_entries`, espelhando o padrão de `meeting_events`). Todo funil passa a ler eventos por `occurred_at`, nunca `stage_key` atual.

### Conversão é cohort/flow, não 5 contagens de período
- **Pipedrive Conversion Report** e **HubSpot Funnel** fixam a coorte que **entrou** num período e medem que fração progrediu a cada etapa — um único modelo de flow, mesmo denominador.
- Todos separam explicitamente **snapshot** (quantos estão agora) de **flow/cohort** (quantos da coorte X converteram), rotulado na tela.
- → **Torque:** uma RPC canônica `get_funnel_flow(org, pipeline_id, cohort_start, cohort_end)` sobre `pipeline_stage_events`. UI declara "coorte de entrada" e a âncora de data em cada card.

### Etapa carrega significado governado, não label
- **Salesforce**: `StageName` é editável, mas `IsWon`/`IsClosed`/`ForecastCategory` são imutáveis e é neles que as métricas chaveiam. **HubSpot**: stage type + probability como metadata. Renomear "Proposal Sent" nunca quebra um report.
- → **Torque:** FK `pipeline_entries.(pipeline_id, stage_key) → pipeline_stages`; promover semântica a colunas: `is_won`, `is_lost`, `is_meeting_booked`, `is_meeting_held`, `stage_role`, `win_probability`. RPCs filtram por flag, não por string. **Resolve de uma vez** hardcode, rename, o typo, forecast e habilita custom pipelines.

### Uma âncora canônica por métrica (semantic layer)
- **dbt MetricFlow / Cube / Looker LookML**: a métrica é definida **uma vez** (measure + grain + time anchor + dimensões), versionada em git, testada, servida por API única. Impossível divergir por copy-paste porque não há segunda cópia.
- **Salesforce** força `CloseDate` como âncora única de forecast.
- → **Torque:** persistir a âncora canônica **no momento do evento** (`sold_at` no trigger de venda, nunca `updated_at`); documentar a âncora de cada métrica; proibir fallback `updated_at`.

### Atribuição como snapshot imutável (soma fecha)
- **Salesforce** grava `OwnerId` + owner-no-evento em `OpportunityHistory`; **Opportunity Splits** fixam o crédito (70% AE / 30% SDR = 100%). Owner-at-event **nunca** é reescrito por edição posterior.
- → **Torque:** estender `meeting_events` para `sale_events` (o próprio ADR-0007 previu o escape hatch): `event_type sale_won|sale_lost`, `closer_snapshot`, `sdr_snapshot`, `revenue` snapshot. Comissão + pódio + velocity + attribution leem **só** o ledger. Invariante testada: `SUM(por membro) + não_atribuído = total`.

### Rede de segurança semântica no CI
- Times world-class rodam **testes de reconciliação** (dbt tests / Great Expectations): "soma das partes == total", "taxa em [0,100]", "métrica A na data X == métrica B na data X". Falha no CI **antes** de chegar no usuário.
- → **Torque:** já existe `tests/integration` com Supabase local. Adicionar invariantes: receita Dashboard == Financeiro == Ranking pro mesmo período; toda `conversion_rate` em [0,100]; funil monotonicamente não-crescente. É isso que impede a "correção 6×".

---

## 5. Superfícies não-auditadas (risco não medido)

O crítico de completude apontou 11 áreas fora do escopo desta rodada, várias com impacto direto em dinheiro. Recomendo uma 2ª rodada:

1. **RPC Financeiro inteira** (MRR/CAC/seller profitability) — nenhum dos 8 domínios tocou; CAC-por-origem mistura coorte de lead com coorte de venda (mesmo cheiro do finding #19). `20260319000003` + fixes.
2. **Multi-moeda** — todo `SUM(sale_value)` soma BRL+USD como se fossem a mesma unidade; conversão só existe client-side (`useConvertCurrency`, retorna null silencioso se falta rate). **Impacto direto em receita.**
3. **Soft-delete leak** — RPCs antigas (SECURITY DEFINER, bypassam RLS) **não filtram `deleted_at`**; as novas (meeting-events) filtram. Leads na lixeira ainda contam no Dashboard/Overview mas não nas métricas novas → duas superfícies divergem pelo conjunto de lixeira.
4. **Carteira/upsell** — segunda "receita" com âncora própria `sold_at`; agrega client-side (herda bugs de moeda e timezone); nunca reconcilia com `pipe_propostas`.
5. **Timezone/virada de mês** — métricas client-side usam data browser-local (UTC-3); RPCs usam UTC. Nas ~3h de virada de mês, uma venda cai em meses diferentes conforme o lado que calcula.
6. **Copilot/IA (`useAgentMetrics`)** — `meetingsScheduled` vem de sinais de conversa, **não** de `meeting_events` → contradiz o ADR-0007. Dois números de "reuniões" pro mesmo período.
7. **Campanhas** — conversão toda client-side, sem RPC; stage strings hardcoded (análogo de custom-pipeline blindness não checado).
8. **Gamificação** (badges/competições/milestones) — thresholds podem ler âncora/chave de role diferente do ranking → badge desbloqueia em número que não bate com o leaderboard.
9. **Coaching IA** (`useSDRPerformance`/`useCloserPerformance`) — se usam atribuição diferente, a IA aconselha sobre números inconsistentes com o próprio dashboard do vendedor.
10. **MRR de billing vs MRR de vendas** — "MRR" significa duas coisas (Σ vendas `product_type='mrr'` vs o que orgs pagam por assinatura); nunca reconciliadas.
11. **Webhook delivery / cron** — 0 métrica de taxa de entrega/DLQ. Falha silenciosa de ingestão deprime **todo** funil downstream sem sinal observável.

---

## 6. Roadmap recomendado

Ordem pensada por **alavanca × risco**, não por facilidade. As fundações (F) desbloqueiam os sintomas.

### Fase 0 — Estancar sangramento (dias) — quick wins isolados
- [ ] **#6**: corrigir a fórmula Reunião→Proposta (`propostas/reuniões`). 1 linha. Métrica hoje é literalmente falsa.
- [ ] **#7**: corrigir o typo `confirmada_no_dia` → checar `metadata.is_confirmed`.
- [ ] **#22**: adicionar `assert_org_access` em `get_segment_benchmark` (fechar vazamento cross-tenant).
- [ ] **#12/#23**: consertar seletor no-op de velocity, `base_ativa` e "Respostas" mentirosos.
- [ ] **Soft-delete (gap #3)**: adicionar filtro `deleted_at`/`is_shadow` nas RPCs antigas.

### Fase 1 — Fundações (2–4 semanas) — atacam R1, R2, R3
- [ ] **F1 · `pipeline_stage_events`** (append-only, trigger em `pipeline_entries`, backfill de `lead_history`). Mata R1. Base do funil, ciclo e velocity corretos.
- [ ] **F2 · Etapa como entidade governada**: FK composto + flags `is_won/is_lost/is_meeting_booked/is_meeting_held` + `stage_role` + `win_probability` em `pipeline_stages`. Backfill mapeia keys atuais. Mata R2 e destrava #5, #20.
- [ ] **F3 · Remover `type='system'` das definições de métrica**; parametrizar por `pipeline_id`. Mata R3 (#4). Testar com org custom-only.

### Fase 2 — Verdade única (3–5 semanas) — atacam R4, R5, R6
- [ ] **F4 · `sale_events`** (espelho de `meeting_events`): trigger emite `sale_won/sale_lost` imutável com `sold_at` fixado no momento, `closer_snapshot`, `sdr_snapshot`, `revenue`. Mata `updated_at` não-determinístico (R4) e unifica atribuição (R5).
- [ ] **F5 · Comissão como projeção do evento**: gerar ledger no trigger de venda. Mata #11, #3 (comissão).
- [ ] **F6 · `get_funnel_flow` canônica** (cohort-based sobre stage_events) + TV/Dashboard consomem só RPCs canônicas (fim do recompute client-side). Mata #1, #10, #14, #16, #18.

### Fase 3 — Governança (contínuo)
- [ ] **G1 · Semantic layer**: começar com tabela `metric_definitions` (nome, grain, time_anchor) ou dbt Core sobre o Postgres. Uma definição, todas as telas consomem.
- [ ] **G2 · Suite de invariantes no CI**: `SUM(membro)+não_atribuído == total`; toda taxa em [0,100]; reconciliação Dashboard==Financeiro==Ranking. **É o que impede a "correção 6×".**
- [ ] **G3 · Rollups incrementais** (matview por org/dia/pipe/stage_role/member via pg_cron) — remove custo O(n)/request e o teto de 500 da TV.
- [ ] **2ª rodada de auditoria** nas 11 superfícies não cobertas (§5), começando por multi-moeda e Financeiro.

---

## 7. Uma frase pra levar

O Torque **acertou o padrão certo** (`meeting_events`) e parou nele. Toda a dor de métrica vem de esse padrão não ter sido generalizado: venda, funil, atribuição e comissão ainda derivam de **estado mutável, string editável e cópia inline**. A correção não é caçar mais 24 bugs — é generalizar o event-sourcing que já existe e colocar uma camada semântica com testes de reconciliação por cima. Aí os números param de brigar entre si.
