# MACRO — Composer da TV (alvo VIVACIDADE) + fatias

> Arquiteto (Cais) · épico #1194 · decisão CTO 2026-07-26 (alvo = mockup `ff96`) · aterrado em prod + spec do Vitral (`design-tv-vivacity-revision.md`, CP-v3).
> NÃO implementação. Macro + fatias ordenadas. Issues só após ratificação do CTO. Crivo roda rubric BLOQUEANTE (área frágil: multi-tenant, cliente escreve o próprio painel).

## Contexto

Entregamos motor + composição + renderers e **zero capacidade de compor**: grep `insert|update|delete|upsert` em dashboard_widgets/pages no frontend = 0; único escritor = `fn_seed_default_dashboard`. A parede da Milennials (2 páginas, 17 widgets = template #1207 nunca customizado) tem **4 células `legacy:*` em BRANCO** (frame + `—`, sem corpo — #1219 nunca construída) e Line/Donut **mortos** (recortes vivos = total/closer/etapa/origem/sdr). CTO quer a vivacidade do `ff96`.

## Decisão de schema (o split que o Vitral me delegou)

**Fato medido:** `metric_catalog_formats` = formatos de NÚMERO (currency_brl/integer/percent_1/duration_human/ratio_2); `dashboard_widgets.format_id` guarda number-format. **Não há coluna de estilo visual** — o visual sempre foi derivado (`resolveChartType`). Então a colisão de nome do Vitral se resolve assim:

1. **DESAMBIGUAR `format_id` → `value_format` via EXPAND/CONTRACT** (ratificação CTO — NÃO rename seco). Razão: `merge em main = deploy de front em prod automático (EasyPanel :latest)`, `migration = manual`; não-atômicos, e não há ordem segura pro rename seco (migration-antes → front lê `format_id` sumido; merge-antes → front lê `value_format` inexistente), sem ambiente de validação. Então:
   - **(expand, S1)** migration aditiva: ADD `value_format`, backfill de `format_id`, dual-sync (default/trigger mantém os dois iguais enquanto durar). Código lê `value_format ?? format_id`, escreve nos DOIS.
   - **(contract, S7, fatia separada, prod já estável)** DROP `format_id`. Janela de quebra = zero nos dois sentidos. Mesmo padrão do swap dos helpers do S1 do gestor de portfólio.
   Catálogo `metric_catalog_formats` permanece (documentar = number-formats).
2. **ADD** `dashboard_widgets.widget_style` (nullable, FK → **nova** tabela `metric_catalog_widget_styles`) — os 7 formatos visuais. `null` = derivado.
3. **ADD** `dashboard_widgets.style_variant` (nullable) — o PARÂMETRO (gauge:tube|bar|radial, ranking:podium|list, funil:bars|trapézio, line:full|spark, number:trend). Validado por trigger contra os variants permitidos do estilo. **Não** jsonb (conjunto fechado → coluna validável).
4. **ADD** `dashboard_widgets.accent_hue` (nullable) — entrada da paleta `--chart-*`/`--metric-ramp-*` (§2.5, zero token novo). `null` → default **por medida** (estável entre páginas — decisão do aberto do Vitral).
5. **Novas tabelas read-only, deny-all, semeadas por migration** (padrão #1194): `metric_catalog_widget_styles` (7 shapes) + `metric_catalog_measure_styles` (measure→estilos compatíveis) + `metric_catalog_style_variants` (style→variants). FK de `widget_style`/`style_variant`.

Precedência (Vitral §1.2, ratifico): `estilo = widget_style ?? deriveStyle(measure, recorte)`. `resolveChartType` (#1251) **vira o default `deriveStyle`, não morre**. Galeria só oferece estilo ∈ `compatible_styles(measure)`; incompatível = ausente, nunca erro.

## Decisão de write-path (o coração do Composer)

**Escrita só via RPCs SECURITY DEFINER** — nunca PostgREST direto. RLS: `SELECT` para membros (leem a parede), **INSERT/UPDATE/DELETE negados a authenticated**; os RPCs são o único escritor (mesmo padrão do `fn_seed`). RPCs:
- `fn_upsert_dashboard_widget(...)`, `fn_delete_dashboard_widget(id)`, `fn_reorder_dashboard_widgets(page, order[])`, `fn_create_dashboard_page(...)`, `fn_rename_dashboard_page(...)`.

**Autorização em 3 camadas (área frágil):**
1. `PERFORM assert_org_access(p_org_id)` 1ª instrução — **mas NÃO basta**: pós-#1209 barra inativo, porém libera QUALQUER membro ativo. Reformatar a parede compartilhada da empresa não é de qualquer membro.
2. **Gate de permissão explícito**: `is_org_admin(org) OR user_has_org_permission(org, 'manage_tv_dashboard')` (novo action key). Sem isso → `raise exception` (403).
3. **Validação contra catálogo NA ESCRITA** (fronteira ADR-0023, herda #1194/#1207): FK (measure/recorte/value_format/widget_style/accent_hue) + trigger — `widget_style ∈ compatible_styles(measure)`, `style_variant ∈ variants(style)`, `≤1 hero/página`, `≤12 widgets/página`, `filters` só allowlist e **nunca `organization_id`** (vem do auth), e **NUNCA cria `legacy:*`** (só o seed herda; o Composer rejeita `measure_kind='legacy'` na escrita).

**Invalidação do snapshot:** `fn_dashboard_snapshot` lê live (sem cache server). O editor (Composer) invalida no client: onSuccess de cada RPC → invalidar `["dashboard-snapshot", org, pageId]` + `["dashboard-pages", org]`. A TV (poll 30s) auto-cura mesmo sem invalidação; o editor precisa da invalidação pra UX responsiva.

## Fatias ordenadas

> Prioridade dura do CTO: **as 4 células em branco fecham CEDO** (ele olha a TV todo dia). → **S1**.

### S1 — Fecha as 4 células em branco [v1, PRIORIDADE 1, CTO-visível]
Schema **expand** (ADD `value_format` + backfill + dual-sync; ADD `widget_style`/`style_variant`/`accent_hue`; tabelas de catálogo de estilo). **NÃO** dropar `format_id` aqui — código lê `value_format ?? format_id`, escreve nos dois (janela zero). Constrói **Progresso** (gauge:tube/bar/radial) e **Ranking** (podium/list) nativos (o corpo da #1219, como NATIVO). Re-seed `fn_seed_default_dashboard`: `legacy:thermometer`→Progresso·tube; `legacy:closer-performance` (1 medida)→Ranking·podium. **Nenhum `legacy:*` fica em branco** (regra dura Vitral §5.0). Fecha os 4 buracos **sem** depender da UI do Composer (re-seed é server-side).
**⚠️ Re-seed = ESCRITA DESTRUTIVA em org VIVA (Milennials, CTO olha todo dia) — 3 guardas obrigatórias:**
1. **Cirúrgico, não big-bang.** Toca **só os 4 widgets `legacy:*`** (replace por `renderer_id`); NÃO reescreve os 13 composable nem apaga a página. Blast radius = 4 células.
2. **Backup antes de sobrescrever.** Dump da composição atual (pages+widgets da org) para artefato restaurável ANTES do write — `dashboard_composition_backup(org_id, snapshot jsonb, taken_at)`. Sem backup = escrita sem volta, mesmo sendo "só o template".
3. **Idempotente.** Keyed no `renderer_id` legacy: re-rodar encontra já-promovido → no-op (nunca duplica, nunca reverte edição futura do cliente). Update-by-stable-key, nunca INSERT cego.

**Rollback:** restaurar a composição do backup (passo 2) — procedimento documentado no PR.

**Gap do ALVO (decisão Cais 2026-07-27):** Progresso (§2.1 #5) = valor ÷ ALVO + pace + delta, mas o motor NÃO serve alvo (`fn_dashboard_snapshot` devolve só value/series; a meta do `SalesThermometer` vinha da tabela `goals`, FORA do motor). **S1 = opção (b): `ProgressRenderer` aceita `target` OPCIONAL; sem alvo (caso do S1) degrada honesto** — renderiza o valor da medida (Número), **sem gauge/pace/meta inventada**. NÃO construir motor-de-metas no S1 ((a)/(c) rejeitadas — estouram escopo). Gauge-com-meta real (§2.1 #5) = **nova fatia "motor serve alvo (liga `goals`)"**, follow-up sob #1194 (recomendar ao Pauta). `legacy:closer-performance`→Ranking·podium `receita/closer` (dedup vs. o bar existente — não 2 widgets do mesmo corte). `accent_hue` criado mas **NULL** no S1 (canal de acento é S6).

**Aceite:** parede Milennials sem célula `—`-sem-corpo; termômetro e closers com corpo nativo; **os 13 composable intocados**; **backup capturado antes do re-seed**; re-seed **idempotente** (2ª execução = no-op, provado em pgTAP); rollback testado; unit dos 2 renderers; flag intocada.

### S2 — Motor devolve label humano + escopo de etapa [v1, defeito visível]
`fn_dashboard_snapshot`/leaf resolvem `key`→`label` humano na série (`compareceu`→"Compareceu", `meta_ads`→"Meta Ads", `carteira`→"Carteira"). `recorte=etapa` exige filtro de pipeline (36 etapas de funis somadas é turvo); sem filtro, degrada pra `total`.
**Aceite:** zero rótulo cru na parede; etapa escopada por pipeline ou degradada; pgTAP.

### S3 — Write-path do Composer (backend) [v1, área frágil, Crivo bloqueante]
Os RPCs + RLS + gate de permissão (`manage_tv_dashboard`) + validação na escrita + contrato de invalidação. Sem UI ainda.
**Aceite:** RPC cria/edita/remove/reordena com validação; membro sem permissão = 403; cross-org isolado (pgTAP); rejeita criar `legacy:*`, `>12/página`, `>1 hero`, `org_id` no payload, estilo incompatível.

### S4 — Composer UI [v1, Vitral + engenheiro]
Galeria de estilos (só compatíveis), place/reorder, seletor de estilo (7 + variants), seletor de acento, consumindo S3. **Line/Donut tornam-se alcançáveis** (já construídos, faltava escolha). `legacy:closer-performance` multi-medida → estado `legacy-locked` ("widget avançado · ainda não editável"), nunca em branco; Composer não cria legacy.
**Aceite:** cliente monta/edita a própria parede; incompatível ausente na galeria; batimento não regride honestidade.

### S5 — Completa o vocabulário [v1-tail]
**Funil** nativo (ordem de estágio + **taxa entre etapas**, §2.1 #7) + **Número·trend** (sparkline) + **Line·spark**. Fecha os 7 formatos.
**Aceite:** os 7 renderizam; funil com taxa e rampa ordinal (não arco-íris); trend/spark.

### S6 — Vivacidade fina [v1-tail]
Canal de **acento** no `WidgetFrame` (filete 1–2px / tick, número intocado, §3/§6) + **batimento honesto** (§4: pulso 1×/snapshot real, estático entre, sem pulso em reduced-motion, `.tv-live-badge` morto removido).
**Aceite:** cor só na geometria/filete, número creme/gold; pulso 1×/refresh; reduced-motion sem pulso.

### S7 — Contract: DROP format_id [v1-tail, só com prod estável]
Depois que `value_format` está em prod e o front (S1+) lê/escreve nos dois há pelo menos um ciclo estável: migration que **DROP `format_id`** + remove o dual-sync + código passa a ler só `value_format`. Rollback pareado (re-add + backfill reverso).
**Aceite:** `format_id` some do schema e do código; TV intacta na janela (nada lê o dropado); pgTAP.

### v2 (fora do v1)
Widget **composto multi-medida** (tabela de closers vendas+ticket+%, cards de pré-vendas) — o único caso que o contrato 1-medida-por-widget não cobre; até existir, `closer-performance` multi-medida fica `legacy-locked` (não em branco). Campos-personalizados como recorte; safra/coorte.

## Disposição do legado de issues
- **#1219** (corpos legados): **FECHAR** — superseded. O termômetro vira Progresso nativo (S1), não renderer legado. A intenção (corpo do termômetro/closer) é absorvida por S1.
- **#1220** (4 conversões como barra): **FECHAR reformulado** — o alvo (funil/ranking distintos) agora é atingido PROPRIAMENTE pelos renderers nativos (S1 Ranking, S5 Funil), não pela aproximação-em-barra. Não reabrir como-era.
- **Rótulo cru do motor**: **defeito, fatia própria = S2** (não feature).

## Áreas frágeis
Multi-tenant (cliente escreve o próprio painel — S3 é o gate), Copilot n/a, RLS/permissões (novo action `manage_tv_dashboard`), Uazapi n/a. **Revisor: rubric BLOQUEANTE em S3** (write-path): permissão real além de assert_org_access, org do auth nunca do payload, sem criar legacy, cross-org.

## Riscos
| Risco | Mitigação |
|---|---|
| Rename `format_id`→`value_format` quebra fn_seed/snapshot/front | Migration + rollback pareado; grep dos call-sites; é cedo (só rows semeadas) |
| Cliente reformata parede de outro (multi-tenant) | RPC SECURITY DEFINER + assert_org_access + gate de permissão + org do auth |
| Membro comum reformata a parede da empresa | Gate `manage_tv_dashboard`/admin, não só membership |
| Re-seed do S1 é escrita destrutiva em org viva | Cirúrgico (só os 4 legacy) + backup da composição antes + idempotente (no-op na 2ª) + rollback documentado (ver S1). Não basta "é só o template" |
| widget_style guarda valor que o motor não serve | FK + trigger de compatibilidade (galeria só oferece compatível) |

## CONTEXT PACKET — CP-v4

**Alvo (paths decididos):**
- `supabase/migrations/*` — (S1) split de schema + tabelas catálogo de estilo + re-seed; (S2) label no motor; (S3) RPCs write + RLS + trigger de validação. Rollback pareado cada.
- `dashboard_widgets`: RENOMEAR `format_id`→`value_format`; ADD `widget_style`/`style_variant`/`accent_hue`.
- Novas: `metric_catalog_widget_styles`, `metric_catalog_measure_styles`, `metric_catalog_style_variants` (read-only, deny-all, seed).
- `_shared`? não — é frontend + DB. Renderers: `src/modules/analytics/components/tv/composable/renderers/{ProgressRenderer,RankingRenderer,FunnelRenderer}.tsx` (S1/S5); `TVWidgetBody` switch cresce.
- `fn_dashboard_snapshot`/leaf — label humano (S2); RPCs write (S3).
- Permissão: novo action `manage_tv_dashboard` no permission engine.

**Área frágil:** multi-tenant write (S3), RLS/permissões.

**Descartado (arquitetural):**
- PostgREST direto p/ escrita — validação é fronteira de segurança, vai em RPC SECURITY DEFINER (não RLS-only).
- Só `assert_org_access` como autorização — insuficiente (libera qualquer membro ativo); precisa gate de permissão.
- `style_variant` como jsonb — conjunto fechado, vira coluna validável.
- Reviver #1219/#1220 como-eram — superseded pelos renderers nativos.
- `accent_hue` por posição — escolhido POR MEDIDA (estável entre páginas).

**Herdado do Vitral (CP-v3), não re-investigar:** 4 células legacy em branco; Line/Donut mortos por derivação-sem-escolha; 36 etapas com label cru; parede = template nunca customizado; `resolveChartType` já tem precedência explicit-vence.

**Aberto (decisão de produto do CTO):**
- `etapa` exige filtro de pipeline OU degrada p/ total (S2 implementa a degradação; a exigência-na-galeria é S4).
- Multi-medida composto: v2 (confirmado fora do v1).
- Novo action `manage_tv_dashboard`: default só admin, ou permissão configurável? (favoreço admin no v1, permissão fina em fatia posterior).
