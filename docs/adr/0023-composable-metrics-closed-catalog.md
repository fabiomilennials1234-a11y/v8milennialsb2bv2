# ADR-0023 — Métricas montáveis sobre catálogo fechado

- **Status**: Aceito
- **Data**: 2026-07-22
- **Responde**: #1004 (Decisão: camada semântica — `metric_definitions` vs dbt)
- **Referencia**: ADR-0007 (métricas de reunião event-sourced), ADR-0017 (vendas e etapas event-sourced), ADR-0005 (Carteira standalone)
- **PRD pai**: #986

## Contexto

Duas dores de cliente, medidas e recorrentes:

1. **Cada org precisa de uma métrica diferente.** Hoje toda métrica nova é um pedido ao CTO → um RPC novo → deploy. Existem 23 hooks de métrica em `src/modules/analytics/hooks/`, 14 deles chamando um RPC próprio e pré-canônico. A curva é linear no número de pedidos e não converge.
2. **A métrica quebra quando o cliente mexe na configuração.** Renomear ou reordenar etapa quebrava número. O ADR-0017 já resolveu a raiz disso ao separar *papel semântico* (`stage_role`) de *rótulo*, mas a superfície de leitura ainda é hardcoded por RPC.

O ADR-0017 entregou o **caderno**: `pipeline_stage_events` (41.866 linhas), `sale_events` (312), `meeting_events`, e os quatro leitores canônicos `get_sales_metrics` / `get_funnel_flow` / `get_ranking` / `get_commission_ledger`. A flag `canonical_metrics` está ON em 88 de 93 orgs. O que falta é a camada **acima** do caderno: como o cliente monta o que quer ver sem que isso vire um pedido ao CTO.

O modelo de referência é o Monday.com: colunas tipadas semanticamente, e widget = configuração interpretada em runtime. A tradução direta para o Torque tem um problema de segurança que o Monday não tem na mesma intensidade — aqui a configuração toca **dinheiro, comissão e isolamento multi-tenant** de ~30 orgs num único Postgres com RLS.

## Decisão

### 1. Duas camadas, com fronteira dura entre elas

- **Camada semântica** — *o que é uma venda*. Vocabulário **fechado**, definido em código versionado (migrations), não editável pelo tenant. É `stage_role`, `revenue_stream`, `event_type`, e o catálogo de medidas/recortes/formatos.
- **Camada de composição** — *o que aparece na tela*. **Livre** para o cliente: quais widgets, com que medida do catálogo, que recorte, que formato, em que posição.

A fronteira é a propriedade de segurança central deste ADR: **a composição só referencia identificadores do catálogo. Ela nunca contém SQL, nome de tabela, nome de coluna, nem `organization_id`.**

### 2. Camada semântica nativa — nem `metric_definitions` editável, nem dbt

Resposta a #1004.

**Descartado — dbt Core.** É ferramenta de warehouse em lote. O Torque lê métrica ao vivo, por tenant, com RLS no caminho quente, numa TV que fica ligada o dia inteiro. dbt não participa do caminho de leitura; ele materializaria tabelas que depois precisariam da sua própria história de isolamento. Custo operacional (orquestrador, ambiente, CI próprio) alto para um time de 1 CTO + 1 dev júnior, e nenhum dos problemas medidos é de transformação em lote.

**Descartado — tabela `metric_definitions` editável pelo tenant.** É exatamente o vetor que não podemos construir: definição de métrica escrita por usuário e interpretada como consulta. Mesmo com sanitização, ela transforma cada linha de config num alvo de injeção e num caminho indireto para ler outra org. A cadência medida também não justifica: o vocabulário semântico mudou 5 vezes em 8 meses (os valores do enum `stage_role`), enquanto a composição muda toda semana. São coisas com cadências opostas — merecem mecanismos opostos.

**Escolhido — catálogo fechado em SQL versionado + configuração de composição em dados.** O que é raro e perigoso (semântica) vive em migration, revisada, testada em pgTAP. O que é frequente e barato (composição) vive em tabela, editável pelo cliente, e é **validado contra o catálogo no momento da escrita**.

### 3. O motor é despacho sobre conjunto fechado, não construtor de consulta

`fn_metric_measure` é uma função plpgsql com um `CASE` sobre um conjunto fechado de identificadores de medida. Cada ramo é uma consulta SQL **estática, escrita à mão**. Filtros entram como parâmetro ligado, nunca por concatenação.

**Invariante verificável, e o gate do revisor: não existe `EXECUTE` no motor.** Se aparecer `EXECUTE` ali, o desenho foi violado.

A única operação composta é a **razão entre duas medidas**, com profundidade exatamente 1 e exatamente dois filhos, cada um obrigatoriamente um identificador do catálogo. Isso cobre todas as taxas pedidas (conversão, no-show, ticket médio) e não cobre mais nada. Denominador zero devolve `null`, não `0` e não erro.

### 4. Isolamento multi-tenant é herdado, não reinventado

O motor lê apenas de tabelas já org-scoped e segue o padrão exato dos quatro leitores canônicos: `SECURITY DEFINER`, `STABLE`, `SET search_path = public`, e `PERFORM public.assert_org_access(p_org_id)` como primeira instrução. `p_org_id` vem do parâmetro da RPC. **Nenhum conceito novo de RLS no caminho de leitura.**

### 5. `sale_events` é o livro-razão; funil e Carteira são produtores

Carteira deixa de ser um sistema paralelo de receita (R$ 836.789,84 hoje totalmente fora do caderno) e passa a **emitir** para `sale_events`, com identidade de produtor explícita e chave de idempotência real — que hoje **não existe** em `sale_events`.

Etiquetagem por momento do cliente, resolvida por uma única função canônica compartilhada pelos dois produtores: primeira compra = `novo_negocio`, recompra = `carteira`.

### 6. Propósito de funil é declarado, e o estoque tem um terceiro estado

`pipelines.purpose ∈ {venda, operacional, undeclared}`. Funil `venda` nasce com etapas Ganho e Perda indeletáveis. Funil `operacional` não recebe nenhuma e fica explicitamente fora das métricas de receita.

`undeclared` existe para que **o estoque (79 funis custom sem `won`, em 37 orgs) não seja tocado pelo fluxo novo**. O invariante só age sobre `venda`. Migrar o estoque é trabalho separado, com decisão humana por org.

## Consequências

### Positivas

- Métrica nova deixa de ser deploy. Entra no catálogo uma vez; o cliente compõe.
- A superfície de leitura converge: os 23 hooks viram um motor.
- Receita passa a ter uma fonte única. Hoje há duas, e elas não se conhecem.
- A configuração do cliente é inerte por construção — não é código, não é consulta.

### Negativas, assumidas

- O catálogo é gargalo por desenho. Medida fora dele continua sendo pedido ao CTO. É o preço do vocabulário fechado, e é o preço certo: a alternativa é o vetor de injeção.
- `sale_events` ganha colunas nulas para linhas de Carteira (`pipeline_id`, `stage_key`), o que obriga cada leitor a tratar o caso. Auditado leitor a leitor.
- Ligar o produtor de Carteira muda o volume do caderno em ~2,7× em valor. Toda comparação histórica passa a precisar de recorte por produtor.

### Riscos que este ADR não resolve sozinho

- **Dupla contagem de receita** entre produtores. Mitigado por índice único de produtor e por relatório de reconciliação **antes** de qualquer escrita em produção.
- **Comissão.** Pedido de Carteira nunca gerou comissão. Emitir com `source='trigger'` faria a projeção rodar sobre eles. A projeção fica **desligada** para `producer='carteira'` até decisão explícita do CTO, em fatia própria.
- **`assert_org_access` não checa `team_members.is_active`.** Falha pré-existente, herdada pelos quatro leitores atuais e pelo motor novo. Corrigida em fatia própria, porque o raio de alcance é maior que esta feature.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| dbt Core | Lote, não caminho quente. Isolamento por tenant vira problema novo. Custo operacional injustificado. |
| `metric_definitions` editável pelo tenant | Vetor de injeção e de leitura cross-org. Cadência de mudança não justifica. |
| Construtor de consulta genérico (árvore de expressão livre) | Superfície de ataque ilimitada sobre tabelas de dinheiro. A razão com profundidade 1 cobre 100% do catálogo v1 pedido. |
| Job em lote lendo `upsell_orders` para o caderno | Segundo modelo de consistência para o mesmo livro. Janela em que dinheiro está aprovado e fora do caderno. Ainda precisaria do índice único. |
| Campos personalizados como recorte no v1 | 446 de 457 definições são texto livre. Não agregam. Fica para v2. |
| Âncora de safra/coorte no v1 | Foto do período cobre o pedido e é explicável no rótulo do widget. Safra fica para v2. |
