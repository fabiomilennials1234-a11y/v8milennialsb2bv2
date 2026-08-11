# Métricas v2 — Comando como fila, Estúdio como análise

Roadmap dos 4 épicos abertos na Sprint Torque: **SCRUM-297** (Comando), **SCRUM-307**
(Estúdio + relatórios), **SCRUM-314** (métricas personalizadas), **SCRUM-321** (UI/UX).
Guarda-chuva: SCRUM-11.

Já em `develop` (PRs #1494 e #1497): rota `/metricas` integrada ao shell, catálogo
lateral de 29 métricas, 4 formas de exibição, aba "Próximos passos" default no Comando.
**Ambas rodam com amostra determinística.** Esta spec descreve o que falta para virarem
produto.

> Os números de produção abaixo foram medidos em **2026-08-11** contra
> `jsjsmuncfkbsbzqzqhfq`. Onde repo e prod divergem, vale prod.

## 1. Estado medido — leia antes de estimar

### 1.1 O motor existe e é menor do que parece

`fn_metric_measure(p_org_id, p_measure_ref jsonb, p_recorte, p_period, p_ref, p_start, p_end, p_filters)`
— plpgsql, STABLE, SECURITY DEFINER, `search_path='public'`, `assert_org_access` como
primeira instrução. **Zero `EXECUTE` confirmado** nas 13 funções do épico (regex sobre
`prosrc` em prod).

| | prod | repo |
|---|---|---|
| Medidas no catálogo | **7** | 8 |
| Razões | 3 | 3 |
| Orgs com `composable_metrics_enabled` | **1 de 99** | — |
| `dashboard_pages` / `dashboard_widgets` | 2 / 15 | — |

As 7 medidas em prod: `receita`, `num_vendas`, `leads_criados`, `reunioes_marcadas`,
`reunioes_realizadas`, `leads_na_etapa`, `tempo_medio_etapa`.

🔴 **`reunioes_no_show` NÃO está em prod.** A migration `20260727140000` nunca foi
aplicada — o ledger pula de `20260727120000` para `20260727140241`. Junto dela ficou de
fora a coluna `metric_catalog_measures.goal_type` e o `target` no payload. Qualquer
ticket que dependa de no-show ou de meta precisa aplicar essa migration primeiro.

🔴 **`20270729000010_pipeline_page_stalled_days_filter` também não está em prod.** O
`get_pipeline_page` vivo não tem `p_stalled_min_days`. A faixa "Propostas paradas" copia
o predicado ou aplica a migration — não chama a função.

### 1.2 O que o motor devolve, exatamente

- **`value` XOR `series`, nunca os dois.** `recorte='total'` → `value` preenchido,
  `series: null`. Qualquer outro recorte → `value: null`, `series: [...]`.
- **Toda série sai ordenada por valor DESC** — inclusive `recorte='tempo'`. Não há ordem
  cronológica no payload.
- **`recorte='tempo'` bucketiza sempre por DIA**, `key='YYYY-MM-DD'`, `label='DD/MM'`,
  sem zero-fill. Não existe bucket semanal ou mensal.
- **`kind='ratio'` devolve `series: null` SEMPRE.** Profundidade exatamente 1, dois
  filhos, ambos forçados a `recorte='total'`. Denominador 0 ou nulo → `value: null` +
  `empty_reason='no_rows'`.
- **O motor degrada recorte em silêncio e reporta em `measure.recorte`.**
  `leads_na_etapa` com `recorte='etapa'` sem `filters.pipeline_id` vira escalar total com
  `effective_recorte='total'`.
- Período é vocabulário fechado de 4: `day | week | month | range`. **Não existe `today`,
  não existe `quarter`.** O corte é feito no servidor por `metric_period_bounds`, na
  timezone da org, meia-aberto `[start,end)`. O front nunca calcula fronteira.

### 1.3 O seam do Estúdio é mais estreito do que o código afirma

Três comentários no repo dizem que trocar `buildMetricSample` por `useMetricMeasure`
"não toca nenhum componente". **É falso** e foi verificado:

| `MetricSample` (hoje) | `MetricMeasureResult` (motor) |
|---|---|
| síncrono, completo | assíncrono, com loading/error |
| `value` **e** `series` juntos | `value` XOR `series` |
| `deltaPct` | **não existe** |
| `series[].{open,high,low,close}` | **não existe** — só `{key,label,value}` |
| `slices[]` | é a própria `series` com recorte categórico |
| sem estado de vazio | `empty_reason` + `value: 0` |

`MetricWindow.tsx:62` vira hook com estados, e como o componente é `memo()` com props
posicionais, a mudança sobe para `MetricsCanvas.tsx:64-82`.

**O artefato central que falta não é código, é um mapa:** `StudioMetric → (MeasureRef,
recorte, format_id, filters)`. Hoje `StudioMetric` não carrega nenhum desses campos — a
ligação com o motor existe só como texto livre no campo `source`.

Correção de contagem: o catálogo do Estúdio tem **12** métricas `composable: true`, não
13 como o `CLAUDE.md` do módulo afirma. E dessas 12, só 6 batem 1:1 por id com medida do
motor — `taxa_conversao` e `ticket_medio` são **razões**, `negocios_por_etapa` é
`leads_na_etapa`, `negocios_por_funil` e `receita_por_origem` são pares (medida, recorte).

### 1.4 A fila do Comando esbarra em escala, medida

| | |
|---|---|
| Conversas aguardando resposta (`last_message_direction='incoming'`, não-grupo) | **9.827** |
| Maior org sozinha | **4.059** |
| Paradas há mais de 1 hora | 9.701 (**98,7%**) |
| Sem `lead_id`, logo sem dono | 7.281 (**74%**) |

`max_rows` do PostgREST em prod é **1000 e corta sem erro**. Contar em JS mente.

O predicado já existe: `p_waiting` em `get_whatsapp_conversation_list`
(`20260727140241:123`), aplicado antes do LIMIT — mas exige `p_instance`, devolve linhas
e clampa em 1000. Serve como **lista**, não como **contagem**.

A base natural do COUNT org-wide é `whatsapp_conversation_summary`: 1 linha por conversa,
42.556 linhas, índice de recência pronto, RLS org-scoped.

**`sla_configs` é miragem.** Existe, tem UI, tem hook — e **0 linhas em prod em todas as
orgs**, nenhum consumidor no sistema inteiro, e modela tempo máximo **na etapa do funil**,
não latência de resposta. A faixa 1 não pode se apoiar nela.

**Não existe campo de "última atuação" por lead.** `leads` não tem `last_activity_at`. Os
proxies são o último `lead_history` (8.623 linhas com `organization_id` NULL) ou
`leads.updated_at`, que qualquer trigger suja. `days_since_last_order` só existe em
`upsell_clients` e cobre 855 clientes — contra 26.283 leads sem responsável.

### 1.5 Relatório: mais infra do que se supunha

Existe geração de PDF **no backend**: `pdf-lib@1.17.1` via esm.sh em
`process-agent-document/pdf-chunking.ts`, usando a API de escrita (`create`/`addPage`/
`save`). Não existe geração no frontend, nem feature de PDF entregue ao usuário.

Já pronto para reuso: `exceljs` (XLSX no browser, sempre por `await import`),
`useExportLeads` completo (permissão + batching + slug + formatação pt-BR), o padrão de
download em 5 cópias, `data_export_requests` **com RLS e sem consumidor**, e envio de
e-mail via Resend em `forgot-password`.

### 1.6 Permissão: a ordem é inegociável

81 chaves em prod. `metrics.view` **não existe**. `useFeaturePermission` é fail-closed
(`features?.[key] === true`) — gate antes do seed tranca todo membro não-admin, e o admin
que testa não vê nada de errado porque passa antes da chave ser consultada.

🔴 **O seed do catálogo só existe em migrations arquivadas.** Uma branch efêmera nasce
com **4 chaves** (só as `voip.*`). Validar gate de rota em branch dá **falso-negativo**.

Assimetria viva: menu usa `!== false` (fail-open), rota usa `=== true` (fail-closed) — é
o que produz "item aparece e ao clicar dá Lock".

## 2. Decisões

1. **Comando é fila; Estúdio é análise.** Comando responde "o que faço agora", Estúdio
   responde "o que olho". Portas cruzadas nas duas direções, já implementadas.

2. **Toda faixa da fila tem janela temporal.** Sem recorte de tempo a faixa 1 é backlog
   de 4.059 itens. A janela é parâmetro por faixa, com default explícito no ticket.

3. **Contagem é sempre server-side.** `count: 'exact', head: true` ou RPC de COUNT.
   Nunca `items.length`. O contrato `ActionLane` já separa `total` de `items` por isso.

4. **O limiar da faixa 1 não vem de `sla_configs`.** A tabela modela outra coisa e está
   vazia. Decidir entre constante versionada ou coluna nova em `organizations` — e a
   decisão vai no ticket, não no código.

5. **O Estúdio consome o motor pelo mapa, não por convenção de nome.** Criar
   `metrics-studio-engine-map.ts` ligando cada `StudioMetric` a
   `{measureRef, recorte, format_id, filters}`. Métrica sem entrada no mapa continua
   como amostra e é marcada como tal na UI.

6. **Vela (candlestick) sai do Estúdio quando o motor entrar.** O motor não tem OHLC e
   não há coluna nem agregação para isso. Manter o gráfico sem fonte seria mentir. A
   decisão de construir OHLC no servidor é ticket próprio, fora deste roadmap.

7. **`taxa_conversao` e `ticket_medio` perdem Linha/Pizza/Vela.** São razões; o motor
   devolve `series: null` sempre. O catálogo do Estúdio precisa refletir isso em
   `charts`, senão o primeiro dia com motor ligado mostra gráfico vazio.

8. **`deltaPct` custa uma segunda chamada.** O motor não compara períodos. Ou o indicador
   de alta/baixa vira uma 2ª chamada com `period='range'` deslocado, ou some. Escolher
   no ticket — não deixar o número mentir.

9. **Formato vem do `format_id` do motor, não da unidade do Estúdio.** Os vocabulários
   divergem (`duration` × `duration_seconds`) e há **duas** funções `formatMetricValue`
   com assinaturas incompatíveis que compilam trocadas. Consolidar numa só.

10. **`empty_reason` é exibido como ausência, não como zero.** O motor devolve `value: 0`
    com `empty_reason='no_rows'`. A TV já resolve isso com travessão
    (`tv-metric-format.ts`); o Estúdio adota o mesmo.

11. **O recorte efetivo manda no rótulo.** O motor degrada e reporta em `measure.recorte`.
    Ignorar esse campo faz a janela dizer "por Etapa" sobre um total — defeito que o
    #1254 já corrigiu na TV.

12. **Persistência do painel migra para `dashboard_pages`/`dashboard_widgets`.** Já
    existem, já validam contra o catálogo na escrita, já têm RLS (membro lê, admin
    escreve). O `localStorage` atual não sobrevive a troca de máquina.

13. **Relatório é montagem, não construção do zero.** XLSX por `exceljs` no cliente
    (caminho provado). PDF só se necessário, e então em edge function Deno com
    `pdf-lib` — com teto de isolate em mente, o vizinho mais próximo já estourou
    `WORKER_RESOURCE_LIMIT` e teve de virar stream.

14. **Métrica personalizada é árvore fechada, nunca fórmula em texto.** Ver §3.

15. **`metrics.view` entra em prod antes do gate no front.** Ordem invertida tranca todo
    membro. Ver §4.

## 3. A fronteira das métricas personalizadas (SCRUM-315)

O ADR-0023 está **Aceito** e descartou explicitamente definição de métrica editável pelo
tenant, com esta justificativa literal:

> "É exatamente o vetor que não podemos construir: definição de métrica escrita por
> usuário e interpretada como consulta."

"Qualquer fórmula com qualquer variável", ao pé da letra, contraria a decisão vigente.

**Proposta a aprovar ou vetar** — generalizar de forma fechada:

| Dimensão | Hoje | Proposta |
|---|---|---|
| Profundidade | exatamente 1 | N ≤ 3, validado na escrita **e** em runtime |
| Operadores | só razão | `+ − × ÷`, conjunto fechado |
| Operandos | id do catálogo | id do catálogo + filtro tipado da allowlist |
| Constante literal | não existe | a decidir |
| Representação | `{kind,num,den}` | árvore tipada em jsonb, **nunca texto** |

O que **não** muda, em nenhuma hipótese:

- Zero `EXECUTE` no motor — continua sendo um grep verificável.
- Nenhum nome de tabela ou coluna atravessa a fronteira de composição.
- `organization_id` vem de parâmetro do servidor, jamais do payload.
- `assert_org_access(p_org_id)` como primeira instrução.

**Fatia que não espera essa decisão:** "conversão da etapa X para a etapa Y"
(SCRUM-316) provavelmente cabe no operador de razão que já existe. Pergunta a responder
no ticket: conversão se mede por **estoque** (quantos estão em cada etapa) ou por
**fluxo** (quantos atravessaram na janela)? São números diferentes.
`pipeline_stage_events` permite fluxo — 61.822 linhas, cobrindo 100% das 428 propostas
abertas.

## 4. Ordem de execução

Precondições que travam tudo que vem depois:

1. **SCRUM-315** — emenda do ADR. Bloqueia o épico 3 inteiro. Não é ticket de código.
2. **Aplicar `20260727140000`** se no-show ou meta entrarem em escopo.
3. **Semear `metrics.view` em prod** antes de qualquer gate no front.
4. **Escrever o mapa `StudioMetric → MeasureRef`** antes de qualquer ticket que ligue o
   motor.

Sequência recomendada para a sprint atual (fecha 21/08):

| Ordem | Ticket | Por quê |
|---|---|---|
| 1 | SCRUM-315 | destrava o épico 3, custa decisão e não código |
| 2 | SCRUM-310 | mata a amostra — é o que faz a tela deixar de ser protótipo |
| 3 | SCRUM-308 | barato, resolve o painel editável por acidente |
| 4 | SCRUM-298 + subtarefas | a fila do Comando com dado real |

O resto do roadmap não cabe em 10 dias. Escalar isso é decisão do CTO, não do agente.

## 5. Invariantes

Valem para todo ticket deste roadmap. Violação é reprovação, não discussão.

- **Zero `EXECUTE`** em qualquer função do motor.
- **`assert_org_access(p_org_id)` como primeira instrução** de RPC nova do motor.
- **`SECURITY DEFINER` + `STABLE` + `SET search_path='public'`** no padrão do épico.
- **Os três REVOKEs**: `REVOKE EXECUTE FROM PUBLIC`, `FROM anon` e `FROM authenticated`,
  seguidos de bloco `DO` que **aborta a transação** se `has_function_privilege` disser o
  contrário. Migration verde não prova nada — o grant é concedido pelo banco no `CREATE`,
  não pelo SQL da migration. As duas metades da armadilha são independentes e uma esconde
  a outra.
- **Policy nunca faz `SELECT ... FROM team_members` inline** — usar
  `get_my_organization_ids()`. Subquery inline causa recursão quando o Realtime avalia
  `apply_rls()`.
- **`get_my_admin_organization_ids()` inclui gestor de portfólio.** Para admin puro, a
  helper é `get_my_team_admin_organization_ids()`. O nome não distingue; só o corpo.
- **`service_role` tem `BYPASSRLS=true` em prod.** RLS não é backstop atrás de edge
  function — IDOR é checado na mão. Há um terceiro role com bypass: `mcp_readonly`.
- **Migration é só schema** (guarda F4). Sem DML de dado de cliente.
- **Rollback pareado** em `supabase/migrations/rollback/<mesmo-nome>.sql`. Não é enforced
  por CI — é disciplina.
- **Prefixo de 14 dígitos é gate bloqueante com baseline zero.** Conferir contra
  `ls supabase/migrations/` antes de nomear. Colisão já matou lote em apply real.
- **Não copiar o template de tabela multi-tenant do `supabase/migrations/CLAUDE.md`** —
  ele usa `auth.org_id()`, que não existe. Ver §7.

## 6. Riscos medidos

- Dois contadores do Comando **já** buscam tabela inteira e contam em JS sem `.limit()`:
  `useDashboardMetrics.ts:385-394` sobre `meeting_events` e `pipe_propostas`. Hoje
  escapam porque a maior org tem 616 eventos. Passando de 1000, a taxa de conversão de
  reunião cai sem sintoma.
- `resolve_org_for_rpc` (usada por `get_next_best_actions`) **não conhece master** —
  devolve vazio sem erro. Reusá-la no Comando quebra o master ghost em silêncio.
- `meeting_events` só tem 2 tipos: `meeting_booked` e `meeting_held`. **Não existe
  no-show, cancelamento nem confirmação.** "Sem confirmação D-0" e "remarcada 1×" — os
  dois motivos da fixture — não são deriváveis de linhas. Remarcação com |Δ| ≤ 30 dias
  faz UPDATE da linha existente, não INSERT.
- `meeting_events` só nasce de entry no pipe `confirmacao` ou stage `agendado`/
  `compareceu`. Org que renomeou stage gera evento nenhum e a faixa fica vazia sem erro —
  precedente vivo: o caso Labarr.
- 225 eventos `meeting_booked` estão com `meeting_date` NULL. Filtrar por `meeting_date`
  os esconde; usar `COALESCE` os joga no dia do registro. Os dois lados erram — é decisão
  de produto.
- O trigger de `whatsapp_conversation_summary` é **AFTER INSERT apenas**. Soft-delete e
  edição não atualizam a linha-resumo.
- `whatsapp_conversation_summary` é por `(org, instance, phone)` — a mesma pessoa em dois
  números vira duas linhas "aguardando".
- N janelas abertas no Estúdio = N chamadas a `fn_metric_measure`. Não há batch para
  painel efêmero — `fn_dashboard_snapshot` é amarrado a página persistida.
- `fn_metric_measure` **não consulta** `composable_metrics_enabled`. Ligar o motor no
  Estúdio expõe a feature a todas as orgs, ao contrário da TV.
- Gerar PDF em edge function tem teto de isolate. O vizinho mais próximo estourou
  `WORKER_RESOURCE_LIMIT` e virou stream.
- O CSV de `useExportLeads` **não neutraliza fórmula** (`=`, `+`, `-`, `@` no início da
  célula) e os dados vêm de campo livre. Copiar o helper herda a CSV injection.
- `pg_net` tem timeout de 5s. Cron que gere relatório precisa enfileirar-e-sair.
- Os ratchets `INV-2=100` e `INV-4=90` do pgTAP nunca foram apertados contra contagem
  viva. "pgTAP passou" não prova que a função nova pinou `search_path` nem que não ficou
  aberta a anon — só `has_function_privilege` prova.

## 7. Achados fora do escopo deste roadmap

Encontrados durante o levantamento. Não são desta feature; merecem ticket próprio.

| # | Achado | Onde |
|---|---|---|
| 1 | 🔴 `export_lead_data(uuid)` tem `EXECUTE` para **anon** — `SECURITY DEFINER` devolvendo jsonb do lead | baseline:42191 |
| 2 | 🔴 `featureKey="checklists.view"` não existe no catálogo de prod → Lock silencioso para membro | `src/App.tsx:449` |
| 3 | 🔴 Template de migration multi-tenant do doc oficial usa `auth.org_id()`, inexistente — produz migration que não aplica. Já custou o incidente Bertin | `supabase/migrations/CLAUDE.md:66-72` |
| 4 | `send-to-number.ts:107` grava `sent_source` fora do CHECK → falha 23514 sempre, engolida por `console.warn` | `_shared/action-handlers/` |
| 5 | `user_has_org_permission` cobre 5 de 9 chaves; as outras 4 retornam sempre `false` para não-admin | baseline:21136-21143 |
| 6 | `guard:master-ghost` existe em `package.json:20` e não está em workflow nenhum — gate escrito que nunca roda | — |
| 7 | `sensitive_access_log_test.sql` não está registrado em `run.sh` — suíte que não roda | `supabase/tests/` |
| 8 | Toggle de módulo em `MemberPermissions` quebrado por drift de slug (`'Performance'` × `'performance'`) | `MemberPermissions.tsx:30-46` |
| 9 | `data_export_requests` tem tabela, RLS e produtor — e nenhum consumidor. Status fica `pending` para sempre | `useDataExport.ts` |
| 10 | `validate_widget_against_catalog` tem `EXECUTE` para anon/authenticated — drift vs o REVOKE do resto da fatia | prod |

## 8. Arquivos

Frontend, existentes:
- `src/modules/analytics/pages/MetricsStudio.tsx`
- `src/modules/analytics/hooks/{useMetricsStudio,useMetricMeasure,useMetricCatalog,useDashboardSnapshot,useComposableDashboard}.ts`
- `src/modules/analytics/lib/{metrics-studio-catalog,metrics-studio-sample,proximos-passos-sample}.ts`
- `src/modules/analytics/components/metrics-studio/**`
- `src/modules/analytics/components/dashboard/v2/TabProximosPassos.tsx`
- `src/modules/analytics/lib/{tv-series,tv-metric-format,tv-chart-type,zoned-day}.ts` — camada pura a reusar

A criar:
- `src/modules/analytics/lib/metrics-studio-engine-map.ts` — o mapa da decisão 5

Banco, existentes:
- `20260723100000` catálogo · `20260723100100` motor · `20260723100200` páginas/widgets ·
  `20260723100300` snapshot · `20260723100400` índices · `20260724100000` legacy cells ·
  `20260724100100` seed · `20260727110000` estilos · `20260727110100` re-seed ·
  `20260727120000` rótulo de etapa
- **Não aplicadas em prod:** `20260727140000` (no-show + goal_type),
  `20270729000010` (stalled days)

Testes:
- `supabase/tests/composable_metrics_engine_test.sql` — estender aqui, não criar suíte nova
- Rodar: `supabase start && bash supabase/tests/run.sh`

## 9. Refs

- ADR-0023 — `docs/adr/0023-composable-metrics-closed-catalog.md`
- ADR-0007 (reuniões event-sourced), ADR-0017 (vendas e etapas event-sourced)
- ADR-0021 §5 — gestor de portfólio, o motivo de `get_my_admin_organization_ids` incluir gestor
- Épico #1194 · SCRUM-11 · SCRUM-297 · SCRUM-307 · SCRUM-314 · SCRUM-321
