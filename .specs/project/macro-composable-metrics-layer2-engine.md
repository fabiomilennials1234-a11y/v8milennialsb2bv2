# MACRO — Fundação da Camada de Composição (#1194): motor do catálogo + esquema de composição

> Arquiteto (Cais) · entrada de feature · 2026-07-23 · ADR-0023 · épico #1194
> **Não é código.** Guia Forja (impl) + Vitral (UI de composição). Aterrado em prod real.

## Contexto

Camada 1 (dado) viva em prod: `sale_events` (livro-razão, producers carteira+funil), `pipeline_stage_events`, `meeting_events`, + 4 leitores canônicos. Camada 2 (widgets) especificada em `design-tv-composable-widgets.md`. Falta o **miolo**: o motor que lê medida do catálogo fechado + o esquema onde o cliente monta widget referenciando **só IDs do catálogo**. Fronteira dura do ADR: composição nunca contém SQL/tabela/coluna/`org_id`.

Área **FRÁGIL** — dinheiro, comissão, multi-tenant, RLS. Revisor roda **rubric de segurança bloqueante**.

---

## Decisão arquitetural

### A. Catálogo fechado = TABELAS read-only semeadas por migration (não função-literal, não tabela editável)

Três tabelas de referência, semeadas por migration, **deny-all de escrita** (nenhum grant INSERT/UPDATE/DELETE a ninguém, nem authenticated nem anon; só service_role via migration):
- `metric_catalog_measures(id text PK, label, unit, anchor, ...)`
- `metric_catalog_recortes(id text PK, label, ...)`
- `metric_catalog_formats(id text PK, label, ...)`
- + compatibilidade: `metric_catalog_measure_recortes(measure_id, recorte_id)`, `metric_catalog_measure_formats(measure_id, format_id)`.

**Por que tabelas e não função-literal:** dão âncora relacional. A config de composição faz **FK** para elas → ID inválido vira violação de FK **no momento da escrita**, no banco, não na app. É a forma mais forte da "validação contra o catálogo" que o ADR exige como fronteira de segurança. (Alternativa função-literal descartada: sem FK, validação volta pra app = mais fraca.)

`fn_metric_catalog() returns jsonb` só **serve** o catálogo montado (measures + recortes + formats + compatibilidade) pra UI de composição. Read-only, sem `p_org_id` (catálogo é global, não tem dado de tenant).

### B. Catálogo v1 — 7 medidas × 10 recortes (proposto; **CTO confirma**)

**7 medidas** (cobrem as 3 âncoras do design §4.2):

| id | label | unit | anchor | fonte (caderno) |
|---|---|---|---|---|
| `receita` | Receita | currency | fechamentos | `sale_events` Σ`sale_value` (event_type venda, não revertido) |
| `num_vendas` | Nº de vendas | count | fechamentos | `sale_events` count |
| `leads_criados` | Leads criados | count | entradas | `leads.created_at` no período |
| `reunioes_marcadas` | Reuniões marcadas | count | entradas | `meeting_events` event_type=booked |
| `reunioes_realizadas` | Reuniões realizadas | count | fechamentos | `meeting_events` event_type=held |
| `leads_na_etapa` | Leads na etapa | count | hoje | estado atual (snapshot) |
| `tempo_medio_etapa` | Tempo médio na etapa | duration_seconds | hoje | `pipeline_stage_events` avg(Δ) |

**10 recortes:**
`total`(nenhum) · `closer`(sale_responsible_id) · `sdr`(pre_sale_responsible_id) · `origem` · `tag` · `produto` · `stream`(revenue_stream: novo_negocio/carteira) · `pipeline`(funil) · `etapa`(stage_key) · `tempo`(série temporal).

Compatibilidade declarada por medida (nem toda medida aceita todo recorte — ex.: `tempo_medio_etapa` só `etapa`/`tempo`; `receita` não faz `etapa`). Cada medida declara `compatible_recortes[]` e `compatible_formats[]` (design §3.2).

### C. Motor `fn_metric_measure` — despacho sobre conjunto fechado, ZERO EXECUTE

Padrão idêntico aos 4 leitores canônicos (verificado): `SECURITY DEFINER`, `STABLE`, `SET search_path=public`, **`PERFORM public.assert_org_access(p_org_id)` como 1ª instrução**, retorno `jsonb`.

**Assinatura pública:**
```
fn_metric_measure(
  p_org_id     uuid,
  p_measure_ref jsonb,          -- {"kind":"leaf","id":"receita"} | {"kind":"ratio","num":"num_vendas","den":"leads_criados"}
  p_recorte    text,            -- id do catálogo (enum fechado → escolhe ramo do CASE)
  p_period     text,            -- 'month'|'custom'|'today' (padrão dos leitores)
  p_ref        date DEFAULT null,
  p_start      date DEFAULT null,
  p_end        date DEFAULT null,
  p_filters    jsonb DEFAULT '{}'::jsonb   -- valores LIGADOS: {pipeline_id,member_id,origin,tag_id,product_id,stream}
) RETURNS jsonb
```

**Estrutura interna (2 camadas, sem EXECUTE):**
- `_metric_leaf(p_org_id, p_measure_id, p_recorte, período.., p_filters)` — **CASE sobre `p_measure_id` × sub-CASE sobre `p_recorte`**. Cada ramo = SQL **estático escrito à mão**. Filtros entram **ligados**: `WHERE (p_filters->>'pipeline_id') IS NULL OR pipeline_id = (p_filters->>'pipeline_id')::uuid` — nunca concatenação.
- Wrapper público: `assert_org_access` → se `kind=leaf` chama `_metric_leaf` uma vez; se `kind=ratio` chama `_metric_leaf` **duas vezes** (num, den, cada um um id do catálogo), divide. **Profundidade exatamente 1, exatamente 2 filhos.** `den=0 → null` (não 0, não erro).

**Unit da razão (derivada, determinística):** `count/count → percent`; `currency/count → currency` (ticket médio); senão `ratio` adimensional. Regra fechada no motor. **(CTO: confirmar essa derivação vs. lista fixa de pares.)**

**Âncora (`base: entradas|fechamentos|hoje`) é derivada no motor por medida** e vai no payload (design §4.2: medida sem âncora declarada = **erro no motor**, não string vazia).

**Retorno jsonb:**
```jsonc
{
  "measure_id":"receita", "unit":"currency", "currency":"BRL",
  "anchor":"fechamentos",
  "value": 1312840.55,                    // escalar (recorte=total ou razão)
  "series": [{"key":"uuid","label":"Marina","value":412000.0}],  // recorte com quebra
  "provenance": {"period_label":"jul/2026","stream":null,"note":null},
  "empty_reason": null | "no_rows" | "never_existed"   // §5.4b (carteira estruturalmente vazio)
}
```

**INVARIANTE (gate do revisor, vira lint):** nenhum `EXECUTE` / `format()`-into-query / concat de identificador dentro do motor. Se aparecer, desenho violado. Grep bloqueante em CI + revisor.

### D. Esquema de composição — config em dados, validada contra catálogo na ESCRITA

```
dashboard_pages(
  id uuid pk, organization_id uuid, surface text check in ('tv','command'),
  title text, position int, rotation_seconds int default 20, created_by uuid, ...)   -- RLS org-scoped

dashboard_widgets(
  id uuid pk, organization_id uuid, page_id uuid fk->dashboard_pages,
  grid_col int, grid_row int, grid_w int, grid_h int,
  weight text check in ('hero','primary','secondary'),
  measure_kind text check in ('leaf','ratio'),
  measure_id text  fk-> metric_catalog_measures(id),          -- leaf
  num_measure_id text fk-> metric_catalog_measures(id),       -- ratio
  den_measure_id text fk-> metric_catalog_measures(id),       -- ratio
  recorte_id text  fk-> metric_catalog_recortes(id),
  format_id  text  fk-> metric_catalog_formats(id),
  filters jsonb default '{}',            -- allowlist de chaves; NUNCA org_id
  eyebrow_override text,                 -- <= 28 chars
  pinned bool default false, ...)        -- RLS org-scoped
```

**Fronteira de segurança = validação na escrita, em 3 camadas de banco:**
1. **FK** measure/recorte/format → catálogo (ID inexistente = rejeitado).
2. **CHECK** de enums (surface, weight, measure_kind) + `length(eyebrow_override) <= 28`.
3. **Trigger `validate_widget_against_catalog()` BEFORE INSERT/UPDATE:** recorte ∈ `compatible_recortes(measure)`, format ∈ `compatible_formats(measure)`, ratio → num/den preenchidos e compatíveis, `filters` só contém chaves da allowlist (`pipeline_id,member_id,origin,tag_id,product_id,stream`) com tipos corretos e **sem `organization_id`**. Máx 1 `hero`/página, teto 12 widgets/página (design §6.4).

`organization_id` sempre do auth context (RLS), **nunca** do payload — regra multi-tenant da casa.

### E. Caminho de leitura — snapshot por página (1 round-trip)

- **Widget único:** `fn_metric_measure(...)`.
- **Página inteira (TV liga o dia todo):**
```
fn_dashboard_snapshot(p_org_id uuid, p_page_id uuid, p_period text, p_ref date, p_start date, p_end date) RETURNS jsonb
```
`SECURITY DEFINER`, `STABLE`, `assert_org_access` 1º. Carrega os widgets da página (org-scoped), chama `fn_metric_measure` por widget, **isola erro por widget** (widget que falha → `{"widget_id":..,"error":"unavailable"}`, não derruba a página — design §5.3), devolve array. **Um fetch por página** (design §6.1: snapshot inteiro numa chamada; troca de página = nó em memória, sem fetch).

**Orçamento de performance (#1208):** TV faz poll a cada 30s. N widgets × query-por-widget em loop → até 12 queries/snapshot. Mitigação: teto 12/página + índices compostos no caminho quente (`sale_events(organization_id, sold_at)`, `meeting_events(organization_id, occurred_at, event_type)`, `pipeline_stage_events(organization_id, occurred_at)`). Medir latência do snapshot como gate (Bancada). Se estourar, evoluir p/ CTE single-pass — **watch-item, não v1**.

---

## Onde vive (paths)

**Migrations** (`supabase/migrations/`, timestamps reais UTC — pós-baseline; ver [[dev-retired-branch-policy]]):
1. `..._metric_catalog_tables.sql` — 5 tabelas catálogo + seed + deny-all write + `fn_metric_catalog()`
2. `..._fn_metric_measure_engine.sql` — `_metric_leaf` (CASE) + `fn_metric_measure` wrapper + grants (authenticated execute)
3. `..._composable_dashboard_schema.sql` — `dashboard_pages` + `dashboard_widgets` + RLS + `validate_widget_against_catalog()`
4. `..._fn_dashboard_snapshot.sql` — leitor em lote
5. `..._metric_hotpath_indexes.sql` — índices compostos

**pgTAP** (`supabase/tests/`): 1 por migration + teste do invariante ZERO EXECUTE (grep no `prosrc`) + teste RLS cross-org + teste de rejeição de config inválida (FK/trigger) + teste `den=0 → null`.

**Frontend** (Forja + Vitral): os 24 hooks de `src/modules/analytics/hooks/` convergem para 3:
- `useMetricCatalog()` → monta a UI de composição (Vitral)
- `useMetricMeasure(measureRef, recorte, filters, period)` → widget único
- `useDashboardSnapshot(pageId, period)` → página TV
Legado migra progressivo — **v1 liga só a TV via snapshot**; hooks do Comando migram em fatia posterior. Não deletar os 24 de uma vez.

---

## Escopo

**ENTRA (v1):** catálogo fechado (7×10), motor `fn_metric_measure` (leaf+ratio), `fn_metric_catalog`, esquema de composição + validação na escrita, `fn_dashboard_snapshot`, índices, pgTAP, 3 hooks novos. TV como 1º consumidor.

**NÃO ENTRA:** UI de composição visual (Vitral, fatia própria); os 7 renderers/WidgetFrame (Vitral); migração dos 24 hooks legados do Comando; campos personalizados como recorte (ADR v2); safra/coorte (v2); construtor de expressão livre (ADR descartou); ligar produtor carteira / aviso de virada (fatias próprias já mapeadas).

---

## Contratos (boundary)

- `fn_metric_catalog() → jsonb` (catálogo pra UI; sem org).
- `fn_metric_measure(p_org_id, p_measure_ref jsonb, p_recorte, p_period, p_ref, p_start, p_end, p_filters) → jsonb` (payload acima).
- `fn_dashboard_snapshot(p_org_id, p_page_id, p_period, p_ref, p_start, p_end) → jsonb` (array de payloads por widget, erro isolado).
- Config: `dashboard_pages` + `dashboard_widgets` — composição referencia **só IDs do catálogo**; `organization_id` do auth; validação na escrita (FK+CHECK+trigger).

---

## Critérios de aceite

1. `fn_metric_measure` responde as 7 medidas × recortes compatíveis, escalar e com quebra, unidade+âncora corretas por medida.
2. Razão prof-1/2-filhos funciona p/ conversão, no-show, ticket; `den=0 → null`.
3. **Zero `EXECUTE` no motor** (teste automatizado sobre `prosrc`).
4. Config inválida (ID fora do catálogo, recorte incompatível, filtro com `organization_id`, eyebrow >28) é **rejeitada na escrita** (FK/CHECK/trigger).
5. `fn_dashboard_snapshot` devolve página inteira num fetch; widget quebrado isolado, não derruba a página.
6. RLS: org A nunca lê widget/dado de org B (pgTAP cross-org verde).
7. `assert_org_access` 1ª instrução em toda RPC de leitura.
8. Latência do snapshot de 12 widgets dentro do orçamento #1208 (Bancada mede).

---

## Áreas frágeis a respeitar

Copilot: n/a. **Multi-tenant/RLS: central** — motor e snapshot herdam padrão canônico, assert 1º, org do auth. **Dinheiro/comissão:** medida `receita` expõe recorte `stream`/producer → comissão nunca inclui carteira em silêncio; projeção de comissão segue **desligada p/ producer=carteira** (ADR §Riscos) até decisão do CTO. **Injeção:** o motor é a superfície — invariante ZERO EXECUTE + filtros ligados são a defesa. **Revisor: rubric de segurança bloqueante.**

---

## Riscos + mitigação

| Risco | Mitigação |
|---|---|
| Catálogo é gargalo (medida nova = pedido ao CTO) | **Assumido** por desenho (ADR). Preço do vocabulário fechado. |
| Perf do caminho quente (TV 30s × 12 widgets/página) | Teto 12/página + índices compostos + STABLE; Bancada mede; CTE single-pass é evolução, não v1 |
| Fronteira de validação como propriedade de segurança | Validação **no banco** (FK+CHECK+trigger), não na app; service_role tb valida (trigger não bypassa). Revisor rubric bloqueante |
| `EXECUTE` vazar pro motor | Teste automatizado sobre `prosrc` + grep CI + gate revisor |
| Dupla contagem receita (producers) | Recorte por `stream`/producer no motor; reconciliação já feita camada 1 |
| Comissão sobre carteira | Projeção OFF p/ carteira até CTO (ADR); `receita` recortável por stream |
| `filters` jsonb virar vetor | Allowlist de chaves + tipos no trigger; `organization_id` proibido no payload |

---

## Precisa de decisão do CTO

1. **Catálogo v1**: confirmar as **7 medidas** + **10 recortes** propostos (nomes/conjunto).
2. **Catálogo = tabelas read-only FK-enforced** (recomendo) vs. função-literal. Confirmar.
3. **Unit da razão**: derivação `count/count→percent`, `currency/count→currency` (recomendo) vs. lista fixa de pares permitidos.
4. **v1 = só TV** (recomendo) — Comando/24-hooks migram depois. Confirmar.
5. **Allowlist de `filters`**: confirmar as 6 chaves (`pipeline_id,member_id,origin,tag_id,product_id,stream`).
6. **Comissão/carteira**: confirmar projeção segue OFF p/ carteira (já ADR — só ratificar no boundary do motor).
