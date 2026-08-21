# Auditoria competitiva — Frente 2: Funil, Negócios e Base de Dados de Venda

**Autor**: Cais (arquiteto) · **Data**: 2026-07-27 · **Base**: `main @c934cc3c` + prod `jsjsmuncfkbsbzqzqhfq` (leitura via MCP `read_only`)
**Comparação**: Pipedrive, HubSpot Sales Hub, RD Station CRM
**Escopo**: documento apenas. Nenhuma migration, nenhum PR, nenhuma implementação.

---

## 0. TL;DR — as quatro frases que importam

1. **O objeto de venda deal-centric já existe, está vivo, e não se chama `deals`. Chama-se `sale_events`.** Ledger append-only imutável (`fn_sale_events_block_mutation`), com reversão (`sale_reversed`, 13 eventos), `sale_value`, `currency`, `revenue_stream`, `producer` — **371 eventos em 26 orgs desde 2026-02-23**, e **sem** o UNIQUE que trava o funil. A resposta certa não é construir `deals`: é terminar de migrar para `sale_events`.
2. **`/negocios` (`deals`) é um terceiro modelo, construído inteiro e nunca ligado.** `deals`, `deal_items`, `companies`, `contacts`, `activities`, `deal_contacts`, `deal_insights`, `import_batches`: **0 linhas cada** nas 93 orgs. Tem página, hook com forecast, feature flag. É dívida com aparência de feature — e agora também é redundante com `sale_events`.
3. **O funil vivo tem um teto estrutural cravado no banco**: `uq_pipeline_entries_pipeline_lead` — UNIQUE `(pipeline_id, lead_id)`. Um lead entra num funil **uma vez na vida**. E **44 clientes já recompraram em prod** (14,1% dos que venderam) — registrados no ledger, invisíveis no funil.
4. **`/duplicatas` esteve quebrada 57 dias** (tela em 2026-05-26, RPCs só em 2026-07-22 — `0d3cc421`, #1192). Além disso, duplicata por telefone é impossível (UNIQUE index) e o critério de nome gera **38.260 pares** na maior org, sem paginação. Mas há **728 leads excedentes por e-mail em 22 orgs** esperando: a tela é **útil e ignorada**, não morta. Corrigir, não remover.

> **Duas revisões em 2026-07-27.** (i) Insumo Pauta/Bancada sobre dupla contabilidade de venda → §1.2, §1.5, §1.6 e §1.7 (nova), com medição própria. (ii) Insumo Lanterna → §4 teve o veredito **corrigido de REMOVER para MUDAR**, e a §7 (nova) registra o limite de método que produziu o erro.

---

## 1. A pergunta estrutural: lead-centric vs deal-centric

### 1.1 O que `/negocios` realmente é

`/negocios` é uma implementação **deal-centric completa e ortodoxa** — e completamente inerte.

| Camada | Evidência | Estado |
|---|---|---|
| Rota | `src/App.tsx:520-524` — `<FeatureRoute feature="deals">` | existe |
| Feature flag | `src/modules/platform/lib/feature-registry.ts:101` — "Gestão de negócios com produtos, probabilidade e forecast" | existe |
| Página | `src/modules/pipelines/pages/Negocios.tsx:47-328` — lista + kanban + KPIs + drawer | existe |
| Modelo | `src/modules/carteira/hooks/useDeals.ts:6-39` — `value`, `currency`, `probability`, `expected_close_date`, `won`, `loss_reason_id`, `company_id`, `source_lead_id`, `deal_items[]` | existe |
| Forecast ponderado | `useDeals.ts:169` — `Σ value × probability/100` | existe |
| Ponte pro funil | `pipeline_entries.deal_id` (coluna em prod) | existe |
| Ponte no lead | `leads.contact_id`, `leads.company_entity_id` (colunas em prod) | existe |
| **Dados** | `select count(*)` em prod | **`deals`=0 · `deal_items`=0 · `companies`=0 · `contacts`=0 · `deal_contacts`=0 · `deal_insights`=0 · `activities`=0 · `import_batches`=0** |
| `pipeline_entries.deal_id` preenchido | prod | **0 de 37.303** |

Não é "camada por cima de leads". É um **terceiro sistema paralelo** (ver §1.7 — os outros dois são `pipe_propostas` e `sale_events`), desenhado corretamente no papel do Pipedrive/HubSpot, que nunca recebeu um único registro. Nem a organização Milennials (nossa própria) criou um negócio.

Sintoma de código abandonado, não de código novo: `Negocios.tsx:133` renderiza toda coluna do kanban com o título literal `"Estágio"` — nunca resolve o nome real da stage. Ninguém abriu essa tela em modo kanban com dados.

### 1.2 Onde o dinheiro mora de verdade hoje — em dois lugares ao mesmo tempo

**Via 1 (legada, ainda maioritária no código)**: no `metadata` jsonb de `pipeline_entries`, exposto pela view `pipe_propostas`:

```sql
(pe.metadata ->> 'sale_value')::numeric AS sale_value
```
(`pg_get_viewdef('public.pipe_propostas')`)

Números de prod:

| Métrica | Valor |
|---|---|
| `pipeline_entries` total | 37.303 |
| entries com chave `sale_value` no metadata | **409** |
| entradas no funil de propostas (system) | 674 |
| dessas, com valor preenchido | 409 (**60,7%**) |
| ganhas | 208 |
| perdidas | 53 |
| perdidas **com motivo estruturado** | **16 (30,2%)** |
| leads total | 32.682 |

Ou seja: **2,1% dos leads chegam a ter um objeto de venda com valor**. Nesta via, o momento em que o CRM deveria ficar valioso — o dinheiro — é registrado em campo jsonb sem tipo, sem constraint, sem histórico.

**Via 2 (nova, e é a certa)**: `sale_events` — um ledger de eventos de venda, append-only e imutável.

Colunas (prod): `event_type`, `sold_at`, `sale_value`, `currency`, `revenue_stream`, `sale_responsible_id`, `pre_sale_responsible_id`, `producer`, `origin_record_id`, `stage_event_id`, `reversed_event_id`.
Guardas em prod: `fn_sale_events_block_mutation` (bloqueia UPDATE/DELETE), `fn_sale_events_force_sold_at`, `fn_capture_sale_event`, `fn_carteira_emit_sale_event`, `fn_carteira_reverse_sale_event`, `fn_block_commission_for_carteira`.

| Métrica | Valor |
|---|---|
| eventos totais | 371, em **26 orgs**, desde **2026-02-23** |
| `sale` | 265 |
| `sale_lost` | 93 |
| `sale_reversed` | 13 (com `reversed_event_id` preenchido — estorno funciona) |
| produtores distintos (`producer`) | 2 |
| leads distintos com venda | 313 |
| **leads que venderam mais de uma vez** | **44** |

Isto **é** o objeto de venda deal-centric, com tipo, moeda, data, responsável duplo (pré-venda/venda), fluxo de receita, estorno e trilha de auditoria. É melhor que `deals` (que não tem estorno nem imutabilidade) e é o que Pipedrive/HubSpot não têm de graça: um **ledger**, não um registro mutável. **E não está sujeito ao UNIQUE de `pipeline_entries`** — por isso 44 clientes recompraram nele.

O problema não é falta de modelo. É que **o funil não fala com ele** e a via velha não foi desligada.

### 1.3 O teto estrutural — a evidência decisiva

```
uq_pipeline_entries_pipeline_lead
  CREATE UNIQUE INDEX ON public.pipeline_entries USING btree (pipeline_id, lead_id)
idx_pipeline_entries_pipeline_lead
  CREATE UNIQUE INDEX ON public.pipeline_entries USING btree (pipeline_id, lead_id) WHERE (lead_id IS NOT NULL)
```

Consequência medida em prod:

```
leads com entrada no funil de propostas ............ 674
leads com 2 ou mais entradas ......................... 0
máximo de propostas por lead ......................... 1
```

**Um cliente não pode ter uma segunda proposta. Nunca. É uma restrição de banco, não um bug de UI.** Para vender de novo pro mesmo cliente, o vendedor tem exatamente três saídas, todas ruins: sobrescrever a venda anterior (perde histórico e a métrica do período passado), criar um lead duplicado (barrado pelo UNIQUE de telefone), ou registrar fora do funil.

### 1.4 A recompra já está acontecendo

```
sale_events ......................................... 371
leads distintos com venda ........................... 313
leads que venderam MAIS DE UMA VEZ .................. 44   (14,1%)
eventos pertencentes a esses leads .................. 102  (27,5% do total)
```

Mais: `upsell_clients` = 738 registros em 12 orgs, `upsell_orders` = 305. Existe um subsistema inteiro (`carteira`/`upsell`) que só existe **porque o funil não consegue representar a segunda venda**. A Carteira não é uma feature complementar — é a cicatriz do modelo.

### 1.5 Veredito: **(b) dívida — mas 70% da correção já está construída, com outro nome**

Não é (a) vantagem. É (b) dívida, com uma correção importante à pergunta: **a parte (c) "já resolvida e eu não vi" existe e é maior do que parece — só que não é `/negocios`, é `sale_events`.**

O que está resolvido: o **objeto de venda**. Repetível, tipado, imutável, com estorno, com responsável duplo, vivo em 26 orgs, já registrando recompra.
O que **não** está resolvido: (i) o **funil** não conhece esse objeto — `pipeline_entries` continua com o UNIQUE e continua guardando `sale_value` em jsonb; (ii) a via velha **não foi desligada** e hoje coexistem duas contabilidades de venda divergentes (§1.7).

Contra (a) "vantagem para o ICP": o argumento "B2B via WhatsApp, ciclo curto, um contato = uma venda" descreve a **aquisição**, não o negócio. Fábrica e distribuidora vivem de **pedido recorrente**. 27,5% dos eventos de venda em prod são de clientes recorrentes, com apenas 371 vendas registradas no total — a base é pequena justamente porque o sistema não convida a registrar a segunda. O modelo lead-centric é ótimo até a primeira venda e cego depois dela.

Contra (c) "já resolvido": a solução foi construída e não foi entregue. Schema vazio não resolve nada; é dívida com aparência de feature. Pior: cria a ilusão de cobertura — quem lê o repo (ou o `feature-registry`) conclui que temos gestão de negócios com forecast.

**Onde somos genuinamente melhores** (e isso é real, não consolo): lead em **múltiplos funis simultâneos** é invariante do nosso modelo e o Pipedrive não faz — lá, um deal vive em um pipeline só. Nosso lead está ao mesmo tempo em qualificação, confirmação de reunião e proposta, com visão consolidada. Para operação de WhatsApp com SDR + Closer isso é superior. **A correção certa não é virar Pipedrive — é manter o funil multi-pipe e dar a ele um objeto de venda repetível.**

### 1.6 Custo de mudar — três opções, com recomendação

Premissa comum a todas: **RLS e isolamento**. Toda tabela nova ou alterada precisa de `organization_id` + policy usando `get_my_organization_ids()` / `get_my_admin_organization_ids()` (nunca subquery inline em `team_members` — recursão no `apply_rls()` do Realtime). `deals` e `deal_items` já existem em prod: **auditar as policies delas antes de qualquer coisa** — foram criadas e nunca exercitadas por tráfego real, então nunca foram testadas de verdade. Testar como role `authenticated`, não como superuser.

**Opção A — Ligar o `deals` que já existe (G) — DESCARTADA**
Migrar `sale_value`/`loss_reason` para `deals`, popular `pipeline_entries.deal_id`, trocar a origem da view. **Não fazer.** Seria construir uma **quarta** geração de contabilidade de venda enquanto três coexistem (§1.7), e `deals` é estritamente pior que `sale_events`: mutável, sem estorno, sem `producer`, sem trilha. `deals`/`deal_items`/`companies`/`contacts`/`activities` devem ser **dropadas**, não ligadas — ou, no mínimo, ter a feature flag `deals` desativada e a rota removida para parar de prometer o que não existe. **P** para esconder; **M** para dropar com segurança.

**Opção B — Remover o UNIQUE e datar a entrada (P→M) ← RECOMENDADA**
Trocar `UNIQUE (pipeline_id, lead_id)` por um índice parcial `UNIQUE (pipeline_id, lead_id) WHERE closed_at IS NULL`. Efeito: um lead tem no máximo **uma entrada aberta** por funil, mas pode ter N fechadas ao longo do tempo. Isso destrava recompra **sem trocar de modelo**, sem tabela nova, sem tocar em RLS (a policy de `pipeline_entries` continua idêntica), e o histórico de venda vira consultável por período.
Riscos reais a tratar: (i) todo `.single()` / `.maybeSingle()` em query de entrada por `(lead_id, pipeline)` passa a poder retornar N — auditar `usePipePropostaByLeadId`, `usePipeConfirmacaoByLeadId` e as edge functions do adapter; (ii) métricas que contam "leads no funil" viram "entradas no funil" — decidir explicitamente qual é a certa por métrica. Esforço: **P** no banco, **M** somando a auditoria dos consumidores. Este é o menor movimento que resolve o problema maior.

**Opção C — Deal-centric completo com company de primeira classe (G)**
`companies` ↔ `contacts` ↔ `deals`, migração dos 19.786 leads com string `company`. Meses. Só faz sentido se o ICP mudar para conta grande com múltiplos interlocutores. **Não agora.**

**Opção D — Casar o funil com o ledger (M) ← A CONTINUAÇÃO NATURAL DE B**
Depois de B, apontar o funil para `sale_events` como fonte única: a entrada de proposta emite/consulta evento via `fn_capture_sale_event` em vez de escrever `metadata->>'sale_value'`; a view `pipe_propostas` passa a ler o ledger; as 24 funções da via velha migram para as leituras de `sale_events` (§1.7). É a mesma direção que o #1194 já tomou — só que concluída, com a via velha desligada.

**Recomendação: B agora (destrava recompra, P→M) → D em seguida (unifica a contabilidade, M). A: descartada, esconder e dropar. C: nunca, no ICP atual.**

---

## 1.7 Terceiro eixo — qual é a fonte de verdade de uma venda

Insumo do Pauta/Bancada, **medido de forma independente por mim** e confirmado — com um agravante que muda a conclusão.

Não são duas RPCs divergentes. São **duas famílias inteiras**, contadas em prod via `pg_get_functiondef`:

| Família | Nº de funções | Exemplos |
|---|---|---|
| Lêem **`sale_events`** (nova) | **17** | `get_sales_metrics`, `get_ranking`, `_metric_leaf_sales` (#1194), `get_commission_ledger`, `get_movement_metrics`, `metric_revenue_stream`, `fn_capture_sale_event`, `fn_carteira_emit_sale_event` |
| Lêem **`pipe_propostas`** (legada) | **24** | `get_dashboard_metrics`, `get_ranking_data`, `get_analytics_overview_metrics`, `get_analytics_financial_metrics`, `get_analytics_commercial_metrics`, `get_analytics_pipeline_metrics`, `get_funnel_health`, `get_product_ranking`, `get_next_best_actions`, `get_uf_heatmap`, `get_mkt_origin_metrics` |

Divergência global medida:

| | via `sale_events` | via `pipe_propostas` |
|---|---|---|
| vendas | **265** | 208 |
| perdas | **93** | 53 |

**O agravante: a divergência é bidirecional.** Vendas do mês corrente, por org:

| Org | via `sale_events` | via `pipe_propostas` |
|---|---|---|
| `163874dd…` | 15 | **29** ← funil vê quase o dobro |
| `6030520a…` (Milennials) | **12** | 6 ← ledger vê o dobro (bate com os 5-6 vs 12 da Bancada) |
| `feed1feb…` | **5** | 2 |
| `ab138cd5…` | **3** | 0 |
| `38f3bea4…` | **4** | 3 |
| 5 orgs menores | iguais | iguais |

Não dá para dizer "uma via está adiantada e a outra atrasada". Em Milennials o ledger vê o dobro; na maior org, o funil vê o dobro. São contabilidades **genuinamente inconsistentes, em direções opostas**. Reconciliação não é aritmética — exige decidir, por org, qual evento é real.

**Isto conecta diretamente ao objeto de venda.** A pergunta "lead-centric vs deal-centric" tem, no nosso caso, uma resposta de três camadas:

| Geração | O que é | Estado |
|---|---|---|
| 1ª — `pipe_propostas` / `metadata.sale_value` | venda como **atributo do lead no funil** (lead-centric puro) | **viva, 24 funções, é o que o /dashboard mostra** |
| 2ª — `deals` / `/negocios` | venda como **registro mutável** (deal-centric ortodoxo) | **morta, 0 linhas** |
| 3ª — `sale_events` | venda como **evento imutável** (event-sourced) | **viva, 17 funções, 371 eventos, é o que /performance e a TV mostram** |

A 3ª geração é a resposta certa e **já venceu tecnicamente** — o #1194 escolheu bem. O erro não foi de arquitetura, foi de **execução da migração**: escolheu-se a fonte nova sem desligar a velha, e agora o cliente vê dois números para a mesma pergunta.

**Caminho de desligamento — ordem e risco** (esta é a recomendação pedida):

| # | Passo | Risco | Esforço |
|---|---|---|---|
| 0 | **Reconciliar antes de mexer.** Para cada org com divergência, classificar cada evento discrepante: falta no ledger, sobra no ledger, ou stage do funil errado. Sem isso, qualquer desligamento congela o número errado | — | **M** |
| 1 | **Congelar a via velha para escrita.** Toda venda nova passa por `fn_capture_sale_event`. `pipe_propostas` continua legível, para de ser fonte | baixo — a escrita já tem função canônica | **P** |
| 2 | **Backfill do delta** apurado no passo 0, com `producer` marcando origem e `origin_record_id` apontando a entrada do funil. Rollback já existe no padrão (`fn_rollback_*`) | **alto — é dinheiro de cliente.** Só com dry-run e reconciliação assinada | **M** |
| 3 | **Migrar as 24 funções** da família legada, começando por `get_dashboard_metrics` e `get_ranking_data` — são as que o cliente vê primeiro e as que mais destoam | médio — comissão depende de ranking; validar contra `get_commission_ledger` | **M→G** |
| 4 | **Reduzir `pipe_propostas` a projeção de leitura** sobre o ledger, ou dropar. Só depois de 3 | baixo, se 3 estiver completo | **P** |

**Causa-raiz candidata da divergência — e ela é acionável** (achado da Lanterna, no meu domínio):
**26 stages em 22 orgs têm papel sugerido pendente de revisão** — 16 `open→won`, 10 `open→lost` — com **421 entradas dentro** (`pipeline_stages.suggested_stage_role` preenchido, `stage_role_reviewed_at` NULL; confirmei o padrão em prod). Ou seja: existem stages que na prática significam "vendido" mas estão marcadas como abertas.

Isso explica **os dois sentidos** da divergência bidirecional:
- **Ledger > funil** (Milennials 12 × 6): a venda gerou `sale_event`, mas a stage onde o card parou ainda é `open` — `get_dashboard_metrics`, que lê `pipe_propostas` por `stage_key`, não a conta.
- **Funil > ledger** (org `163874dd` 29 × 15): o card está numa stage de venda, mas nenhum `sale_event` foi emitido — a captura não disparou naquele caminho.

Consequência prática: **o passo 0 (reconciliar) deve começar pela fila de `/master/stage-roles`.** Revisar as 26 stages é barato (**P**), tem dono (a fila já existe) e provavelmente resolve boa parte da discrepância antes de qualquer backfill de dinheiro. Isso rebaixa o risco do passo 2.

**Riscos travessos, para não repetir erro conhecido**: (i) `fn_sale_events_block_mutation` bloqueia UPDATE/DELETE — correção de backfill errado exige evento de estorno, não `UPDATE`; planejar isso **antes**, não durante; (ii) migration de schema não pode carregar backfill de dado de cliente (guarda F4) — o backfill do passo 2 é operação separada e autorizada, não `db push`; (iii) `get_commission_ledger` já lê o ledger enquanto `get_ranking_data` lê o funil: **hoje é possível a comissão e o ranking discordarem**. Vale conferir com quem cuida de comissões antes do passo 3.

---

## 2. Matriz — funil e objeto de venda

| Feature | O que temos hoje (`arquivo:linha`) | Pipedrive / HubSpot / RD | Veredito | Por quê | Esforço |
|---|---|---|---|---|---|
| **Objeto de venda repetível** | 1 entrada por (funil, lead) para sempre — `uq_pipeline_entries_pipeline_lead`; medido: máx. 1 proposta/lead | Deal é o objeto; N deals por contato ao longo dos anos | **MUDAR** | 44 clientes (14,1%) já recompraram; funil não representa | **P→M** (opção B) |
| **Venda como evento imutável (`sale_events`)** | Ledger append-only com estorno e `producer` — 371 eventos, 26 orgs, 17 funções leem | Pipedrive/HubSpot: deal é registro **mutável**; sem ledger, sem estorno auditável | **MANTER+VENDER** | Superior ao padrão de mercado. É o objeto de venda certo — falta o funil falar com ele | — |
| **Fonte de verdade única da venda** | **Duas famílias vivas**: 17 funções em `sale_events`, 24 em `pipe_propostas`. Global: 265 vs 208 vendas, 93 vs 53 perdas. Divergência **bidirecional** por org | Uma fonte. O número do dashboard é o número do relatório | **MUDAR — urgente** | Cliente vê 2 números para a mesma pergunta (Milennials: 6 vs 12). Corrói confiança em tudo mais | **M→G** (§1.7) |
| **`deals` / `/negocios`** | Tabela + página + flag, **0 linhas** em 93 orgs; redundante com `sale_events` e pior (mutável, sem estorno) | n/a | **REMOVER/ESCONDER** | 2ª geração abandonada. Manter visível promete o que não existe | **P** (esconder) / **M** (dropar) |
| **Lead em múltiplos funis simultâneos** | Invariante do modelo — `src/modules/pipelines/CLAUDE.md`, `useLeadAllPipelines` | Pipedrive: deal vive em 1 pipeline só | **MANTER+VENDER** | Superior para SDR+Closer no WhatsApp. É diferencial real, não acidente | — |
| **Valor do negócio** | `metadata->>'sale_value'` jsonb — `pg_get_viewdef('pipe_propostas')`; 409 de 37.303 entries | Campo tipado de 1ª classe no deal | **MUDAR** | Dinheiro em jsonb sem constraint. 60,7% de preenchimento onde deveria ser 100% | **M** |
| **Moeda** | `deals.currency` (tabela vazia); funil vivo não tem | Multi-moeda nativo | **REMOVER/ESCONDER** | ICP é BRL. Não construir; não é dor | — |
| **Data prevista de fechamento** | `deals.expected_close_date` (vazia). Funil vivo: nada | Campo obrigatório de fato; base do forecast | **ADICIONAR** | Sem ela não existe previsão. Cabe em `metadata` hoje | **P** |
| **Probabilidade por stage** | `pipeline_stages.default_probability` existe — e é **50 em 100% das 3.695 stages**, nas 93 orgs | Configurável por stage, alimenta forecast | **MUDAR** | Coluna inerte: constante não pondera nada. Ou torna editável, ou deriva de conversão histórica | **P** (editar) / **M** (derivar) |
| **Forecast de receita** | `WeightedForecast.tsx` + `useAnalyticsPipesFunis.ts:87` (RPC) — existe em Analytics, alimentado por `win_probability` da RPC, não pela coluna | Central na venda ("Previsão") | **MANTER + MUDAR posição** | O gráfico existe e funciona; está enterrado em Analytics em vez de ficar no funil, onde a decisão acontece | **P** |
| **Motivo de perda estruturado** | `useLossReasons` + `LossReasonDialog.tsx`; 651 motivos configurados nas 93 orgs (é seed, não adoção) | Obrigatório ao marcar perdido; alimenta relatório de perdas | **MUDAR** | **Só 16 de 53 perdas (30,2%) têm motivo.** O diálogo é pulável. Tornar obrigatório no marcar-perdido. Nota: a perda também tem dupla contabilidade — 93 `sale_lost` no ledger vs 53 no funil | **P** |
| **Relatório de perdas** | Nenhum — motivo fica em `metadata->>'loss_reason'`, sem tela agregadora | Pipedrive/HubSpot: relatório dedicado | **ADICIONAR** | Só depois de corrigir a captura. Relatório sobre 30% dos dados mente | **P** (depois do item acima) |
| **Rotting / estagnação** | `max_days_in_stage` e `sla_hours` **existem em `pipeline_stages` e estão NULL em 100% das 3.695 stages**; único leitor é `useMasterOrganizations.ts:49` (clone de org). Front nunca lê. Tempo em stage só aparece em `CustomPipeLeadCard.tsx:20-22` (funil custom); o `KanbanCard` dos funis de sistema não mostra nada | Pipedrive marca card em vermelho após N dias parado. Religião do produto | **ADICIONAR** (ligar o que existe) | **18.532 de 36.529 entradas abertas (50,7%) estão paradas há 30+ dias e nada no produto sinaliza.** Maior ganho/esforço da frente inteira | **P** |
| **Próxima atividade sempre definida** | Nada. `activities` = 0 linhas. `follow_ups` = 1.122 (existe, mas é opcional e desacoplado do card) | Pipedrive: negócio sem próxima atividade é destacado como problema | **ADICIONAR** | Isso é o que faz o vendedor voltar ao CRM. Reusar `follow_ups`, não criar `activities` | **M** |
| **Produtos / line items** | `deal_items` = 0. Vivo: `pipe_proposta_items` = 620 linhas; `products` = 2.023 em **17 de 93 orgs** | Line items com preço, quantidade, desconto; valor do deal derivado | **MANTER** | Funciona e é usado por quem tem catálogo. 18% de adoção é coerente com ICP variado | — |
| **Valor derivado dos produtos** | Não: `sale_value` é digitado à mão, independente dos itens | Soma automática dos line items | **ADICIONAR** | Elimina digitação e divergência entre proposta e valor | **P** |
| **Campos obrigatórios por stage** | Nada. `checklist_template_id` existe em `pipeline_stages` e está preenchido em **2 de 3.695** | HubSpot: propriedades obrigatórias para avançar de stage | **ADICIONAR** | É a alavanca que corrige a qualidade do dado (valor 60,7%, motivo 30,2%) na origem | **M** |
| **Funis customizados** | `pipelines.type='custom'` — 79 funis em **37 de 93 orgs (40%)** | Pipedrive: múltiplos pipelines | **MANTER** | Adoção sólida. Dos maiores acertos do produto | — |
| **Automação por stage** | Workflows via evento `lead.stage_changed` + `pipe_dispatch_rules` + distribuição round-robin | Pipedrive tem automações; RD tem fluxos | **MANTER+VENDER** | Sequência de template no stage + round-robin no WhatsApp é mais fundo que o padrão de mercado pro nosso ICP | — |
| **Dual model legado (`pipe_*` views ↔ `pipeline_entries`)** | Views legadas sobre `pipeline_entries`; `statusColumns` duplicado em 3 hooks com valores divergentes — `src/modules/pipelines/CLAUDE.md` | n/a | **MUDAR** (dívida conhecida) | Toda mudança no funil custa o dobro. Bloqueia a opção A | **G** |

---

## 3. Matriz — base de contatos

| Feature | O que temos hoje | Pipedrive / HubSpot / RD | Veredito | Por quê | Esforço |
|---|---|---|---|---|---|
| **Dedup na criação** | `idx_leads_org_phone_unique` — UNIQUE `(organization_id, normalized_phone) WHERE deleted_at IS NULL`. Prod: **0 grupos duplicados por telefone**. Webhook devolve erro instrutivo — `supabase/functions/lead-webhook/index.ts:501-509` | Detecção na criação, sugestão de merge | **MANTER+VENDER** | Nosso mecanismo é **mais forte** que o do mercado: eles sugerem, nós tornamos impossível. Chave certa pro canal WhatsApp | — |
| **Tela `/duplicatas`** | `Duplicates.tsx:31-49` + RPC `find_duplicate_leads` (telefone ∪ e-mail ∪ trigram nome ≥0,6). **Ficou 57 dias sem backend** — página em 2026-05-26 (`bf3e51a1`), RPCs só em 2026-07-22 (`0d3cc421`, "página /duplicados quebrada", #1192) | Mercado não tem tela separada: merge inline no contato + dedup na importação | **MUDAR** (não remover) | Ver §4. Corrigida há 5 dias; há trabalho real esperando (728 leads excedentes por e-mail em 22 orgs). Problema é o **critério** e o **ponto de entrada**, não a existência | **P→M** |
| **Merge com histórico** | RPC `merge_leads(p_keep_lead_id, p_merge_lead_id)`, com teste — `useDuplicateLeads.test.ts` | Merge preservando timeline | **MANTER** (mover) | O motor é bom. O problema é o **ponto de entrada**, não o merge | — |
| **Dedup na importação** | `import_batches` = **0 linhas**; `leads.import_batch_id` nunca referenciado no front (só em `types.ts`). `ImportLeadsFunnelModal.tsx` existe mas não rastreia lote | Dedup + preview + desfazer lote é padrão dos três | **ADICIONAR** | Importação é o principal gerador de duplicata do mercado — e onde a nossa é cega. Sem lote não há desfazer | **M** |
| **Empresa como objeto** | `companies`/`contacts` = **0 linhas**; `leads.company` string preenchida em **19.786 de 32.682 (60,5%)** | HubSpot: company ↔ contacts ↔ deals | **ADICIONAR — mas depois** | Limitação real para distribuidora (não dá pra ver "todos os contatos da Empresa X"). Mas só vira dor **depois** de resolver a recompra; sem isso, é tabela nova sem uso — igual `deals` | **G** |
| **Campos customizados** | `lead_custom_fields` = 464 campos em **46 de 93 orgs (49%)**; `lead_custom_field_values` = **53.597** | Padrão nos três | **MANTER+VENDER** | Adoção altíssima e silenciosa. Feature mais usada da frente — e ninguém fala dela | — |
| **Tags** | `tags` = 134, `lead_tags` = 3.619 | Padrão | **MANTER** | Saudável | — |
| **Lixeira** | `leads.deleted_at` + `/lixeira`; 920 leads em prod | HubSpot tem; Pipedrive não | **MANTER** | Soft delete correto, e o UNIQUE de telefone respeita `deleted_at IS NULL` | — |
| **Qualificação (score + tiers)** | `qualification_score` 0-100 + `qualification_tier`/`pre_qualification_tier` (enums), filtráveis em todos os funis e em `/negocios` — `Negocios.tsx:85-91` | HubSpot tem score (pago/enterprise); Pipedrive não; RD tem | **MANTER+VENDER** | Estamos à frente do Pipedrive aqui, e é grátis pro cliente | — |
| **Exportação** | `ExportStageDialog` por stage | CSV/Excel em qualquer lista | **MANTER** | Suficiente | — |

---

## 4. Por que `/duplicatas` não pega — a resposta com evidência

> **Revisão de 2026-07-27, após a Lanterna.** A primeira versão desta seção concluía **REMOVER/ESCONDER**. Está corrigido para **MUDAR**: eu não tinha visto que a página passou 57 dias sem backend, e isso explica o não-uso melhor do que os meus argumentos de design. A análise de critério abaixo continua válida; a conclusão que ela sustentava, não.

**Problema 0 — a tela esteve simplesmente quebrada, e é o que mais explica o não-uso.**
`Duplicates.tsx` nasceu em **2026-05-26** (`bf3e51a1`, slice 4 da modularização). As RPCs `find_duplicate_leads` / `merge_leads` só foram criadas em **2026-07-22** (`0d3cc421`, #1192 — mensagem literal: *"página /duplicados quebrada"*, migration `20270725000000_duplicate_leads_rpcs.sql`). **57 dias de tela chamando função inexistente.** Zero merges na história e `_lead_duplicates_audit` = 0 não medem rejeição do usuário — medem ausência de backend. Foi corrigida há 5 dias; ainda não houve tempo de haver uso.

Isso reordena o resto: os dois problemas abaixo são **reais e continuam valendo**, mas são razões para a tela não *funcionar bem*, não a prova de que ela é dispensável.

**Problema 1 — a tela mede o que já é impossível.**
`find_duplicate_leads` (`prosrc` em prod) casa por três critérios, com o telefone em prioridade 1. Mas o banco tem `idx_leads_org_phone_unique`. Medido: **0 grupos duplicados por telefone em 32.682 leads, em todas as 93 orgs.** O critério mais confiável e mais relevante para um CRM de WhatsApp **nunca retorna nada, por construção**. Quem abre a tela esperando "achei telefone repetido" encontra zero.

**Problema 2 — o que sobra é ruído, em volume que quebra a tela.**
Restam e-mail e similaridade de nome. Medido em prod:

| Critério | Resultado |
|---|---|
| grupos por e-mail (todas as orgs) | 447 grupos / 1.175 leads → **728 leads excedentes**, em 22 orgs (bate 1:1 com a medição da Lanterna: 1.175 − 447 = 728) |
| leads sem e-mail | 12.074 (37%) — invisíveis a esse critério |
| leads excedentes por nome (Lanterna) | 2.122, em 43 orgs |
| **pares por similaridade de nome ≥0,6, só na maior org (3.919 leads)** | **38.260 pares** |

Os dois últimos não se contradizem: 2.122 é o **trabalho real** (leads a eliminar); 38.260 é a **carga que a tela joga na cara do usuário** para achá-lo. A razão entre eles — ~18 pares de ruído por duplicata verdadeira, só numa org — é exatamente o problema.

38 mil pares. A RPC não tem `LIMIT`, não tem paginação, não tem threshold configurável, e `Duplicates.tsx:38-49` filtra **no cliente** sobre o array inteiro. Numa org de 3,9 mil leads a tela pede dezenas de milhares de pares ao servidor e tenta renderizar. "João Silva" × "João Souza" passa de 0,6 e vira sugestão de merge — de um merge **destrutivo e irreversível**.

**A soma:** a tela esteve quebrada 57 dias; quando voltou, tinha sinal zero no critério que mais importa (telefone), ruído de ~18:1 no que sobra, e uma ação irreversível no fim. Nenhum dos três é motivo para matá-la — os 728 + 2.122 leads excedentes são trabalho real, em 22 e 43 orgs. São motivo para **mudar onde ela mora e o que ela mostra**.

**O que o mercado faz e nós não:** a dedup mora **onde o dado entra**. Pipedrive e HubSpot avisam no formulário de criação ("já existe um contato com este e-mail — quer abrir?"), sugerem merge **dentro do registro** ("possível duplicata: [ver]"), e fazem dedup **na importação, antes de gravar**. Nunca numa tela de varredura global de similaridade.

**Recomendação (revisada):**
1. **Manter `/duplicatas`, e primeiro deixá-la usável**: cortar o critério de nome do padrão (ou subir o threshold e exigir 2º sinal — mesmo sobrenome, mesma empresa, mesmo domínio de e-mail), paginar a RPC (hoje sem `LIMIT`) e mover o filtro do cliente para o servidor. Sem isso, a org de 3.919 leads não consegue abrir a tela. (**P**)
2. **Levar a sugestão de merge para dentro do lead**: ao abrir um lead com e-mail idêntico a outro, banner com merge inline. E-mail idêntico é alta precisão; 447 grupos é volume auditável a mão. É onde o mercado põe. (**P**)
3. **Dedup na importação**, com preview antes de gravar e `import_batch_id` para desfazer o lote. É onde a duplicata nasce e o nosso buraco cego (`import_batches` = 0). (**M**)
4. **Não medir adoção desta tela antes de instrumentá-la** — ver §7. Ela foi consertada há 5 dias; qualquer leitura de uso agora é prematura.
5. Similaridade de nome: aposentar como **sugestão automática**, manter como busca sob demanda. 38.260 pares numa org prova que o threshold 0,6 não separa nada.

---

## 5. Prioridade — se for mexer, nesta ordem

Ordenado por (impacto no ICP) ÷ (esforço), não por elegância.

> **Fora da fila, acima dela: reconciliar a contabilidade de venda (§1.7).** Não é item de melhoria — é o chão. Enquanto `/dashboard` e `/performance` derem números diferentes para "quantas vendas este mês", toda métrica construída em cima herda a dúvida, e nenhum item abaixo é confiável de medir. Passo 0 (reconciliar) + passo 1 (congelar escrita da via velha) antes de tudo. **M + P.**

1. **Rotting no card** — ligar `max_days_in_stage` (já existe no schema, NULL em 100%). 50,7% das entradas abertas estão paradas há 30+ dias e o produto não diz nada. **P**
2. **Motivo de perda obrigatório** no marcar-perdido. Sobe a captura de 30,2% para ~100% e destrava o relatório de perdas. **P**
3. **Revisar as 26 stages com papel sugerido pendente** (`/master/stage-roles`, 16 open→won + 10 open→lost, 421 entradas). Barato, tem dono, e é candidata a causa-raiz de boa parte da divergência da §1.7 — fazer **antes** de qualquer backfill. **P**
4. **Tornar `/duplicatas` usável** (paginar, cortar nome do critério padrão, filtro no servidor) + banner de merge inline por e-mail dentro do lead. Há 728 leads excedentes por e-mail em 22 orgs esperando. **P→M**
5. **Remover o UNIQUE `(pipeline_id, lead_id)`** → índice parcial `WHERE closed_at IS NULL`. Destrava recompra sem trocar de modelo. Auditar antes todos os `.single()` por `(lead_id, pipeline)`. **P→M**
6. **Data prevista de fechamento** + trazer o forecast de Analytics para o funil. **P**
7. **Instrumentar `module_visited`** nas rotas desta frente que faltam (`/negocios`, `/duplicatas`, `/produtos`, `/carteira`, `/upsell`, `/comissoes`) — pré-requisito de qualquer decisão de remoção (§7). **P**
8. **Dedup + lote na importação** (`import_batch_id`, preview, desfazer). **M**
9. **Campos obrigatórios por stage** — corrige a qualidade do dado na origem. **M**
10. **Esconder `/negocios` e decidir o destino de `deals`/`companies`/`contacts`/`activities`**: dropar (recomendado) ou manter dormente e documentado. **Não** ligar — seria uma quarta geração. Schema vazio com aparência de feature engana quem lê o repo e infla o `feature-registry`. **P** para esconder, **M** para dropar.
11. **Concluir o desligamento da via `pipe_propostas`** — passos 2 a 4 da §1.7, depois da reconciliação. **M→G.**

---

## 6. Nota fora de escopo

**Sobre a "revisão"** (Pauta confirmou com o CTO que o termo é ambíguo; as duas entram no relatório, nenhuma é da minha frente):
- `/follow-ups`, rotulada **"Revisão"** no menu da org — `src/modules/engagement/pages/Revisao.tsx`. É a de org. `follow_ups` tem 1.122 linhas em prod.
- `/master/stage-roles` — fila master de won/lost sugerido, apoiada em `pipeline_stages.stage_role` / `suggested_stage_role` / `stage_role_reviewed_at` / `stage_role_reviewed_by` (colunas confirmadas em prod).

Ponto de contato com a minha frente: se a "próxima atividade sempre definida" (§2) for construída, ela deve reusar `follow_ups` — que é justamente o que a tela "Revisão" já lista. A feature que falta e a tela que ninguém usa são, provavelmente, o mesmo assunto visto de dois lados.

---

## 7. Aviso de método — o que este documento NÃO mediu

**Nenhum veredito aqui se apoia em page-view.** `usage_events.module_visited` instrumenta **7 módulos** (`pipe_whatsapp`, `chat_whatsapp`, `pipe_propostas`, `pipe_confirmacao`, `leads`, `disparos`, `funis`). `/negocios`, `/duplicatas`, `/produtos`, `/carteira`, `/upsell` e `/comissoes` **não estão instrumentados** (Lanterna, `.specs/audit/uso-real-prod.md`). Para essas rotas, "zero page-views" é **inexistente, não zero** — usar como evidência seria inventar um dado.

O que este documento usa é **pegada de dado**: linhas escritas, colunas preenchidas, índices, definição de função. Isso é forte para provar que algo **não foi usado** (`deals` = 0 linhas em 93 orgs desde que existe, `sla_hours` NULL em 3.695 stages) e **fraco** para explicar **por quê** — como o caso de `/duplicatas` acabou de demonstrar: pegada zero por 57 dias de backend ausente, não por rejeição.

**Regra que tiro disso, para a próxima rodada:** antes de concluir "ninguém usa", checar se a feature (i) esteve funcional no período e (ii) está instrumentada. Falhei nas duas em `/duplicatas`. E instrumentar as rotas faltantes é pré-requisito para qualquer decisão de remoção — **P**, e deveria vir antes do item 8 da §5.

---

**Sobre o menu** (correção do Pauta/Vitral): não escrevi nada sobre fragmentação de menu ou contagem de itens — está fora desta frente. Nenhuma afirmação deste documento depende de `TopNavigation.tsx`. A fragmentação que aponto é de **modelo de dados** (três gerações de objeto de venda), não de navegação.

---

## CONTEXT PACKET — CP-v2

**Alvo**: auditoria competitiva. Frente 2 (funil, objeto de venda, base de contatos) entregue em `.specs/audit/mercado-funil-negocios.md`. **Não commitado — ordem do CTO: nenhum versionamento nesta rodada.** Nenhum comando git foi executado; nenhum arquivo de produto tocado.

**Mapa verificado** (prod `jsjsmuncfkbsbzqzqhfq`, leitura MCP, 2026-07-27):
- `deals`=0, `deal_items`=0, `companies`=0, `contacts`=0, `deal_contacts`=0, `deal_insights`=0, `activities`=0, `import_batches`=0, `commissions`=0 — schema deal-centric completo e **inerte** nas 93 orgs
- `pipeline_entries`=37.303 (36.529 abertas); `deal_id` preenchido em 0
- `leads`=32.682; `company` string em 19.786 (60,5%); 920 na lixeira
- Funil de propostas: 674 entradas · 409 com `sale_value` (60,7%) · 208 ganhas · 53 perdidas · **16 com motivo (30,2%)**
- `sale_events`=371 / 313 leads distintos → **44 leads recompraram (14,1%)**, 102 eventos (27,5%). Composição: `sale`=265, `sale_lost`=93, `sale_reversed`=13 (todos com `reversed_event_id`); 26 orgs; desde 2026-02-23; 2 `producer` distintos. Colunas: `event_type`, `sold_at`, `sale_value`, `currency`, `revenue_stream`, `sale_responsible_id`, `pre_sale_responsible_id`, `producer`, `origin_record_id`, `stage_event_id`, `reversed_event_id`. Guardas: `fn_sale_events_block_mutation` (bloqueia UPDATE/DELETE), `fn_sale_events_force_sold_at`, `fn_capture_sale_event`
- **Dupla contabilidade de venda** (contado via `pg_get_functiondef` sobre `pg_proc`): **17 funções** leem `sale_events` (`get_sales_metrics`, `get_ranking`, `_metric_leaf_sales`, `get_commission_ledger`, `get_movement_metrics`, `metric_revenue_stream`…), **24 funções** leem `pipe_propostas` (`get_dashboard_metrics`, `get_ranking_data`, `get_analytics_*` ×6, `get_funnel_health`, `get_product_ranking`, `get_next_best_actions`…). Global: 265 vs 208 vendas; 93 vs 53 perdas. **Divergência bidirecional** no mês corrente: Milennials 12 (ledger) vs 6 (funil); org `163874dd` 15 vs **29**; `feed1feb` 5 vs 2; `ab138cd5` 3 vs 0
- `pipeline_stages`=3.695 em 93 orgs: `default_probability`=50 em **100%**; `sla_hours` NULL em 100%; `max_days_in_stage` NULL em 100%; `checklist_template_id` em 2
- **50,7%** das entradas abertas (18.532/36.529) sem mudar de stage há 30+ dias
- `lead_custom_fields`=464 em 46 orgs · `lead_custom_field_values`=**53.597** (adoção alta)
- `products`=2.023 em 17 orgs · `pipe_proposta_items`=620 · `upsell_clients`=738 em 12 orgs · `upsell_orders`=305
- `pipelines`: 276 system, 79 custom em 37 orgs (40%)
- Duplicatas: **0** grupos por telefone · 447 grupos por e-mail (1.175 leads = **728 excedentes**, bate com a Lanterna) · **38.260 pares por nome só na maior org**; 12.074 leads sem e-mail. `Duplicates.tsx` criada em 2026-05-26 (`bf3e51a1`), RPCs só em 2026-07-22 (`0d3cc421`, #1192, "página /duplicados quebrada") → **57 dias sem backend**
- `pipeline_stages` com `suggested_stage_role` pendente de revisão: **26 stages em 22 orgs** (16 `open→won`, 10 `open→lost`), **421 entradas** dentro (Lanterna; padrão confirmado por mim em prod) — candidata a causa-raiz da divergência bidirecional
- **Telemetria**: `usage_events.module_visited` cobre só 7 módulos (`pipe_whatsapp`, `chat_whatsapp`, `pipe_propostas`, `pipe_confirmacao`, `leads`, `disparos`, `funis`). `/negocios`, `/duplicatas`, `/produtos`, `/carteira`, `/upsell`, `/comissoes` **não instrumentados** — "zero page-views" nessas rotas é inexistente, não zero
- Índices decisivos: `uq_pipeline_entries_pipeline_lead` UNIQUE `(pipeline_id, lead_id)` · `idx_leads_org_phone_unique` UNIQUE `(organization_id, normalized_phone) WHERE deleted_at IS NULL`
- Dinheiro mora em `pipeline_entries.metadata->>'sale_value'`, exposto pela view `pipe_propostas` (`pg_get_viewdef`)
- Arquivos: `src/App.tsx:520-524` · `src/modules/pipelines/pages/Negocios.tsx:47-328` (col. kanban hardcoded `"Estágio"` em :133) · `src/modules/carteira/hooks/useDeals.ts:6-39,169` · `src/modules/platform/lib/feature-registry.ts:101` · `src/modules/leads/pages/Duplicates.tsx:31-49` · `src/modules/leads/hooks/useDuplicateLeads.ts:31-41` · `src/modules/pipelines/components/custom/CustomPipeLeadCard.tsx:20-22` · `src/modules/identity/master/hooks/useMasterOrganizations.ts:49` · `src/modules/analytics/components/analytics/charts/WeightedForecast.tsx` · `supabase/functions/lead-webhook/index.ts:445-509`

**Achados**:
0. **Existem TRÊS gerações de objeto de venda.** 1ª `pipe_propostas`/`metadata.sale_value` (viva, 24 funções, é o que o /dashboard mostra) · 2ª `deals`/`/negocios` (morta, 0 linhas) · 3ª `sale_events` (viva, 17 funções, 371 eventos, é o que /performance e a TV mostram). A 3ª é a resposta certa — event-sourced, imutável, com estorno, **e sem o UNIQUE que trava o funil**. O #1194 escolheu a fonte certa e **não desligou a velha**. Divergência bidirecional entre as duas vivas ⇒ não é aritmética, exige reconciliação por org.
1. `/negocios` é deal-centric ortodoxo e completo, com **zero linhas** em prod. Não é camada sobre leads — é sistema paralelo morto, e agora também redundante: `sale_events` é estritamente melhor (mutável vs imutável, sem estorno vs com estorno).
2. `uq_pipeline_entries_pipeline_lead` **proíbe recompra por construção** (máx. 1 proposta/lead, medido). E 44 clientes já recompraram.
3. `/duplicatas` falha por **três** causas, e a primeira é a maior: (i) esteve **57 dias sem backend** (2026-05-26→2026-07-22) — pegada zero mede ausência de RPC, não rejeição; (ii) telefone é impossível de duplicar (UNIQUE index → sinal zero no critério que importa); (iii) nome gera 38.260 pares sem paginação (~18:1 de ruído). **Veredito corrigido de REMOVER para MUDAR** — há 728 + 2.122 leads excedentes esperando. Mercado dedup na criação/importação, não em varredura global.
4. Máquina de SLA/rotting **já existe no schema** e está 100% NULL. 50,7% das entradas abertas estão paradas 30+ dias, sem sinal no produto. Maior ganho/esforço da frente.
5. `default_probability` é constante 50 nas 3.695 stages — coluna inerte.
6. Somos genuinamente melhores em: lead multi-funil simultâneo, dedup mecânica por telefone, qualification tiers, campos customizados (53.597 valores), automação por stage.
7. `companies`/`contacts` vazias: limitação real para distribuidora B2B, mas **posterga** — sem resolver recompra antes, vira outra tabela vazia.

**Descartado**:
- "`/negocios` é camada sobre leads" — falso. Tabela própria, modelo próprio, forecast próprio. Só está vazio.
- "Duplicata é problema de descoberta da tela" — falso, mas por motivo diferente do que escrevi na v1: a tela estava **quebrada**, não ignorada.
- **CONTESTADO e corrigido (meu erro, apontado pela Lanterna)**: minha v1 concluiu "REMOVER/ESCONDER `/duplicatas`" a partir de pegada de dado zero. Não checei se a feature esteve funcional no período. Esteve quebrada 57 dias. Veredito agora é **MUDAR**. Regra derivada na §7.
- "Zero page-views prova não-uso" — **não usar**. Telemetria não cobre essas rotas.
- **Opção A "ligar o `deals` que já existe"** — descartada depois do achado 0. Seria uma **quarta** geração; `deals` é estritamente pior que `sale_events`. Esconder e dropar, não ligar.
- Deal-centric completo com `companies`/`contacts` (opção C) — fora do ICP atual, custo G sem retorno proporcional. E `companies` antes de resolver recompra vira outra tabela vazia.
- Multi-moeda — ICP é BRL (`sale_events.currency` já existe se um dia precisar).
- Criar `activities` do zero para "próxima atividade" — `follow_ups` (1.122 linhas) já existe e já tem tela ("Revisão"); reusar.
- "A divergência de venda é uma via atrasada em relação à outra" — falso, medido: é **bidirecional** (Milennials ledger 2× funil; org `163874dd` funil ~2× ledger).

**Aberto**:
- ~~Números de page-view de `/negocios` e `/duplicatas`~~ **RESOLVIDO**: não existem. Rotas não instrumentadas (§7). Fonte: Lanterna, `.specs/audit/uso-real-prod.md`. Instrumentar é item 7 da §5.
- Se as 26 stages com papel pendente explicam **quanto** da divergência da §1.7 — medi o padrão, não o percentual. Cruzar org a org é trabalho da reconciliação (passo 0).
- **Reconciliação da contabilidade de venda por org** (passo 0 da §1.7): quais eventos discrepantes são falta no ledger, sobra no ledger, ou stage errado no funil. É pré-requisito de tudo. Queries de apoio estão com a Bancada.
- Destino de `deals`/`companies`/`contacts`/`activities`: esconder+dropar (minha recomendação) ou manter dormente. **Decisão do CTO.**
- Policies RLS de `deals`/`deal_items` nunca foram exercitadas por tráfego real — se um dia forem ligadas, auditar como role `authenticated` (não superuser) antes.
- `get_commission_ledger` lê `sale_events` enquanto `get_ranking_data` lê `pipe_propostas`: **comissão e ranking podem discordar hoje**. Não medi o impacto — vale confronto com quem cuida de comissões.
- Impacto de remover o UNIQUE `(pipeline_id, lead_id)` sobre os `.single()`/`.maybeSingle()` por `(lead_id, pipeline)` — enumerei o risco, não enumerei os call sites. Auditoria pendente antes de qualquer execução.
