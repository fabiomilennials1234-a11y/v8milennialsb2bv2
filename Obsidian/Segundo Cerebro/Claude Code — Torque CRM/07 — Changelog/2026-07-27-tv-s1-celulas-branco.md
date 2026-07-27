# 2026-07-27 — TV S1 (#1253): fecha as 4 células em branco

> Épico #1194 · macro `.specs/project/macro-composer-tv-vivacidade.md` §S1 (Cais) · spec `docs/design-tv-vivacity-revision.md` (Vitral). Área frágil (escrita em parede VIVA da Milennials — CTO olha todo dia). Crivo bloqueante.

## O que era
Os 4 widgets `legacy:*` (`legacy:thermometer` + `legacy:closer-performance`, pinned, repetidos nas 2 páginas) renderizavam frame + `—` SEM corpo (#1219 nunca construída). Na TV real = 4 buracos em branco. Line/Donut mortos por "derivação sem escolha".

## O que mudou
- **Schema EXPAND** (`supabase/migrations/20260727110000_tv_widget_style_expand.sql`): separa as 3 dimensões que colidiam no `format_id` (Vitral §1.2):
  - `value_format` (formatação de número) — EXPAND de `format_id` via dual-sync (`fn_sync_widget_value_format`); `format_id` **intacto**, DROP é o S7. Código lê `value_format ?? format_id`.
  - `widget_style` (estilo visual, null → derivado) + `style_variant` (FK composto a `metric_catalog_style_variants`) + `accent_hue` (null no S1; canal visual é S6).
  - 3 tabelas de catálogo read-only deny-all semeadas: `metric_catalog_widget_styles` (7), `metric_catalog_style_variants`, `metric_catalog_measure_styles`.
  - `fn_dashboard_snapshot` passa a emitir `widget_style/style_variant/accent_hue/value_format`.
- **Re-seed** (`supabase/migrations/20260727110100_tv_reseed_legacy_to_native.sql`):
  - Part A — `_fn_seed_default_dashboard_unchecked` nasce NATIVA (futuros orgs).
  - Part B — `_fn_reseed_legacy_to_native_unchecked(org)` (SECURITY DEFINER, service-role-only): backup → promote → dedup, **idempotente**. `legacy:thermometer` → Progresso·tube (`receita/total`); `legacy:closer-performance` → Ranking·podium (`receita/closer`). Backfill promove as orgs já semeadas.
  - `dashboard_composition_backup` (org, snapshot, taken_at) — dump ANTES do write.
- **Renderers nativos** (`src/modules/analytics/components/tv/composable/renderers/`):
  - `RankingRenderer` (podium/list) — pessoas ordenadas com identidade; rampa ordinal na geometria, número creme (§3.2).
  - `ProgressRenderer` (tube/bar/radial) — **target OPCIONAL**. Sem alvo (S1: o motor não serve meta, decisão Cais mode b) → degrada para Número (null body; o frame mostra o valor). Gauge-com-meta é fatia futura ("motor serve alvo").
- **Wiring**: `tv-chart-type` (7 tipos + `widget_style ?? deriveStyle`), `TVWidgetBody` (ranking + progress escalar), `TVComposableWall` (precedência de estilo + `value_format` + `styleVariant`), tipo do snapshot ampliado. Zero hex hardcoded (tokens `--tv-*`/`--chart-*`/`--metric-ramp-*` + `tv-metric-format.ts`).

## 3 guardas (escrita em org viva) — provadas
- **Cirúrgico**: toca só os 4 `legacy:*` (por `renderer_id`) + os 2 composable que os promovidos superam. `num_vendas` (não-redundante) intocado — provado em pgTAP.
- **Backup antes**: `dashboard_composition_backup` capturado antes do write; snapshot contém o legacy pré-promoção (restaurável).
- **Idempotente**: keyed no `renderer_id`; 2ª execução = no-op, sem backup duplicado.

## Prova de DB (branch efêmera `tv-s1-1253-qa`, criada → exercitada → ENCERRADA)
- `db push --include-all` aplicou 322+ migrations + as 2 minhas em sequência LIMPO.
- pgTAP `supabase/tests/tv_reseed_s1_test.sql`: **23/23** contra Postgres real (STRUCT, PROMOTE, DEDUP, CIRÚRGICO, BACKUP, IDEMPOTENTE, ACL).
- Rollback testado: os 2 rollbacks aplicam limpo (rc=0) e revertem (colunas/tabelas/fn somem, `format_id` fica). `delete_branch` success — zero cobrança órfã.

## Decisão pendente (sinalizada ao Pauta/CTO)
Cais autorizou dedup só do closer (Q1). Apliquei o mesmo princípio ao `receita/total` (o Progresso o supera → dois números de receita idênticos leem como descuido). Se o intento era só o closer, reverter o 2º `DELETE` no re-seed (documentado no header da migration). **Aguardando decisão do CTO via Pauta antes de mexer** — o backup restaura em qualquer sentido.

## Gates
- `lint`: 0 errors (warnings `any` pré-existentes).
- `build`: verde (tsc + vite).
- `test:unit`: 136 failed == baseline 136 (zero falha nova; +11 testes meus de renderer/chart-type). Vermelho é baseline pré-existente (ratchet drift).

## Follow-ups
- **S1 restante**: QA visual na TV real (Bancada/Palco) — os renderers ainda não foram vistos na tela.
- **Fatia nova (Cais recomenda ao Pauta)**: "motor serve alvo (liga `goals`)" → o Progresso vira gauge-com-meta real (§2.1 #5).
- **S2–S7**: label humano do motor, write-path do Composer, Composer UI, funil/número-trend, vivacidade fina, DROP `format_id`.
