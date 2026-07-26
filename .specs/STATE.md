# STATE — contratos cross-componente vivos

> Estado técnico dos boundaries que mais de um componente depende. Atualizar ao mudar contrato.

## Métricas Montáveis — Camada 2 (#1194 / ADR-0023) — fundação DB

Status: **construído, atrás de flag, pgTAP pendente de run local** (2026-07-23). v1 liga só a TV.

### Flag de rollout
- `organizations.composable_metrics_enabled boolean NOT NULL DEFAULT false`.
- Helper `fn_composable_metrics_enabled(org uuid) → boolean`.
- Gate: escrita de composição (trigger + publish) e leitura de snapshot. Motor `fn_metric_measure` NÃO é gated (é leitor puro; a exposição é gated pelo snapshot/UI).

### Catálogo fechado (read-only, deny-all write)
- Tabelas: `metric_catalog_measures`, `_recortes`, `_formats`, `_measure_recortes`, `_measure_formats`, `_ratios`.
- 7 medidas: `receita, num_vendas, leads_criados, reunioes_marcadas, reunioes_realizadas, leads_na_etapa, tempo_medio_etapa`.
- 10 recortes: `total, closer, sdr, origem, tag, produto, stream, pipeline, etapa, tempo`.
- Compatibilidade medida×recorte declarada em `_measure_recortes` — par ausente = sem query = rejeitado na escrita.
- 3 presets de razão: `conversao (num_vendas/leads_criados)`, `comparecimento (reunioes_realizadas/reunioes_marcadas)`, `ticket_medio (receita/num_vendas)`.
- Servido por `fn_metric_catalog() → jsonb` (global, sem org).

### Motor
- `fn_metric_measure(p_org_id uuid, p_measure_ref jsonb, p_recorte text, p_period text DEFAULT 'month', p_ref date, p_start date, p_end date, p_filters jsonb DEFAULT '{}') → jsonb`.
- `p_measure_ref`: `{"kind":"leaf","id":"receita"}` | `{"kind":"ratio","num":"num_vendas","den":"leads_criados"}`.
- `p_period`: `day|week|month|range` (vocabulário de `metric_period_bounds`).
- `p_filters` allowlist: `pipeline_id, member_id, origin, tag_id, product_id, stream`. NUNCA `organization_id`.
- Retorno leaf: `{measure_id, unit, currency, anchor, recorte, value, series, empty_reason, kind, provenance}`.
- Retorno ratio: `{kind:'ratio', unit, currency, anchor, value, series:null, num:{...}, den:{...}, empty_reason, provenance}`. `den 0|null → value null`.
- Unit da razão: `count/count→percent`, `currency/count→currency`, senão `ratio`.
- INVARIANTE: ZERO EXECUTE no motor (grep CI + gate revisor). Filtros LIGADOS.
- `assert_org_access(p_org_id)` é a 1ª instrução (bloqueia cross-org).

### Composição (config validada na escrita)
- `dashboard_pages(id, organization_id, surface tv|command, title, position, rotation_seconds, draft jsonb, ...)` — RLS org-scoped, escrita admin-only.
- `dashboard_widgets(... measure_kind leaf|ratio, measure_id|num_measure_id|den_measure_id → catálogo FK, recorte_id, format_id, filters, weight hero|primary|secondary, eyebrow_override ≤28, ...)`.
- Validação na escrita: FK (catálogo) + CHECK (enums, eyebrow, coerência leaf/ratio) + trigger `validate_widget_against_catalog` (recorte/format compatíveis, filters só allowlist e sem org_id, máx 1 hero/página, teto 12/página, gate de flag).
- `draft jsonb` = staging do Composer (Vitral); não passa por FK enquanto rascunho.

### Leitura em lote (TV)
- `fn_dashboard_snapshot(p_org_id, p_page_id, p_period, p_ref, p_start, p_end) → jsonb` = `{disabled, page_id, widgets[]}`. 1 fetch/página, teto 12, erro isolado por widget (`{widget_id, error:'unavailable'}`), gate de flag (`disabled:true` se OFF).

### Publish atômico
- `fn_publish_dashboard_page(p_org_id, p_page_id) → jsonb` = `{published, page_id}`. Lê `dashboard_pages.draft.widgets[]`, valida cada um (trigger), swap `DELETE`+`INSERT` numa transação → atômico (inválido reverte, parede anterior sobrevive). Gate: admin/master + flag.

### Hooks (frontend)
- `useMetricCatalog()`, `useMetricMeasure({measureRef, recorte, period, filters, ...})`, `useDashboardSnapshot({pageId, period, pollMs=30_000})` em `@/modules/analytics`. v1 liga só a TV via snapshot.

### Aterramento (colunas reais)
- receita/num_vendas → `sale_events` (event_type='sale', líquido de estorno, `sold_at <@ bounds`). closer=`sale_responsible_id`, sdr=`pre_sale_responsible_id`, stream=`revenue_stream`.
- leads_criados → `leads` `COALESCE(metrics_period_at, created_at)`, `deleted_at IS NULL`.
- reunioes → `meeting_events` (`meeting_booked` por occurred_at; `meeting_held` por COALESCE(meeting_date, occurred_at)).
- leads_na_etapa → `pipeline_entries` abertas (snapshot).
- tempo_medio_etapa → `pipeline_stage_events` dwell desde a última transição (snapshot).

### Comissão/carteira
- Motor só lê. `receita` recortável por `stream` → comissão nunca inclui carteira em silêncio. Projeção segue OFF p/ producer=carteira (ADR).

---

## Casca da TV montável (#1207) — grid, WidgetFrame, painel semeado

Status: **construído, atrás de flag, pgTAP 19/19 + unit 21/21 verdes** (2026-07-24). Worktree `feat/tv-shell-1207`.

### Célula legada reservada
- `metric_catalog_renderers(id, label, description, is_legacy, sort)` — read-only, RLS, deny-all de escrita. Semeada com `legacy:closer-performance` e `legacy:thermometer`.
- `dashboard_widgets.renderer_id text` → **FK** para o catálogo de renderers (fronteira declarativa, mesmo mecanismo do #1194 — não allowlist em trigger).
- `measure_kind` agora `leaf|ratio|legacy`. `recorte_id`/`format_id` viraram NULLABLE; `kind_coherence` é o único guardião e declara os 3 ramos explicitamente + `ELSE false`.
- `renderer_id` é NULL em leaf/ratio (simetria: sem isso o snapshot ficaria ambíguo).
- `fn_dashboard_snapshot` emite a célula legada com `measure: null` — **não chama `fn_metric_measure`**. Payload ganhou `measure_kind`, `renderer_id`, `recorte_id`, `filters`.
- `fn_metric_catalog()` passou a servir `renderers` (o Composer filtra por `is_legacy` para não oferecer célula reservada como composível).

### Semeadura
- `fn_seed_default_dashboard(p_org_id) → jsonb` — `SECURITY DEFINER`, `assert_org_access` 1ª instrução, gate de flag, **idempotente** (org com painel de TV não é tocada).
- Gatilhos: trigger no **flip da flag** (`organizations.composable_metrics_enabled` false→true) + backfill por migration. **Nunca lazy-on-read.**
- Semeia 2 páginas (§8.4.6): "Fechamento" (8 widgets) e "Time e topo de funil" (9 widgets). Os 2 pinned legados entram em CADA página — 20 de 72 células, 28% permanente.
- ⚠ **A derivação por quiz não roda**: `org_onboarding` não existe em prod, então `generateTVConfig` sempre devolve `DEFAULT_CONFIG`. O seed reproduz a composição padrão. `tv-config-from-quiz.ts` está `@deprecated`.

### Frontend
- `WidgetFrame` (eyebrow · valor de cabeça · corpo · faixa de proveniência) — o MESMO componente servirá TV e Comando.
- `ProvenanceLine` — faixa obrigatória em 100% dos widgets; degradação **medida em tempo de render** (ResizeObserver), ordem 4→3→abrevia 2→colapsa 1; a âncora nunca some.
- `TVGrid`/`TVGridCell` — 12×6, gap 20px, padding 24px, **sem rolagem**; fonte única de layout, inclusive `pinned`.
- `TVComposableWall` — consome `fn_dashboard_snapshot` (UMA chamada por atualização), aplica teto de densidade, isola erro por widget.
- `TVComposableShell` — `data-surface="tv"` + indicador de frescor (§5.4).
- Gate: `TVDashboardRouter` em `TVDashboard.tsx`. Flag OFF nem monta o caminho novo.
- Libs puras testadas: `tv-metric-format` (ausência = `—`, nunca 0), `tv-provenance`, `tv-density` (teto de 8 dispara por **tipografia**, não por célula).
