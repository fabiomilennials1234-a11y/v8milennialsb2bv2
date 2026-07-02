---
type: changelog
title: 2026-06-26 — Gestor (/insights) — unit economics master-only por org (CAC, payback, curva J)
status: shipped
created: 2026-06-26
updated: 2026-06-26
tags: [insights, unit-economics, master, cac, payback, analytics]
related: ["[[Master Operations]]", "[[Multi-tenancy]]", "[[Schema]]", "[[RLS Policies]]"]
owner: gabriel
---

# 2026-06-26 — Gestor (/insights) — unit economics master-only por org (CAC, payback, curva J)

## Contexto

Ferramenta nova **só para o operador da plataforma (master)** calcular *unit economics* de uma org **arbitrária**: CAC com bandas-alvo, payback por nº de compras, LTV e curva J (linha do tempo). O master seleciona a org, o sistema puxa as vendas reais ao vivo, e o master digita os pressupostos de custo. Modelo de cálculo alinhado à planilha do CTO.

Acesso: botão **Gestor** (antes "Insights") no `OrgSwitcher`, rota top-level `/insights` com chrome próprio (azul `insights`), **fora** do `MasterLayout`. Lazy via `MasterInsights` em `src/App.tsx`. Duas abas: **Dados** (números reais) e **Projeção** (what-if).

## Mudanças

- **Tela master-only `/insights`** (#916): engine pura de CAC/Payback + UI completa. Botão azul no `OrgSwitcher`, rota lazy, empty/loading/error states, autosave dos pressupostos.
- **Coorte de vendas + linha do tempo** (#916, depois refinada): a métrica de venda passou a ser por **coorte** (leads criados no período que efetivamente venderam), e a UI ganhou a **curva J** de unit economics (`UnitEconomicsJourneyChart`) substituindo o `JCurveChart` inicial.
- **Engine de CAC alinhada à planilha do CTO** (#919): `cacMaximo = ticketMedio − lucroLiquido = custoNaoAquisicao / numVendas` (teto-alvo); banda **Bom = máx/2**, **Escala = máx/3**. `cacAtual` (aquisição/anúncios rateado por venda) é a agulha — pode ultrapassar o teto e cair na **zona vermelha**. Payback medido em **nº de compras** (`payback1 = cacAtual / margemPorVenda`; `payback2` com LTV = `ticketMedio × recompras`).
- **Custo por produto + modo margem de contribuição** (#920): painel de despesas ganhou `custo_por_produto` (por unidade × nº vendas) e dois modos de custo não-aquisição — **detalhado** (itens) ou **mc** (margem de contribuição % do ticket). Comissão do vendedor (`comissao_pct`, % do faturamento) entra na soma do CAC.
- **Rename "Insights" → "Gestor"** (#921): botão e wordmark renomeados; rota e token de cor `insights` preservados.

## Por quê

- O master precisava avaliar a saúde econômica de cada tenant (CAC sustentável? payback em quantas compras? curva J?) sem expor esses pressupostos ao próprio tenant — por isso **RLS gateada em `is_master_user()`**, não em pertencimento à org (master não tem `team_members`).
- A definição de "venda" **reusa a canônica** do `get_dashboard_metrics` (`pipe_propostas`, status `vendido`, período `COALESCE(metrics_period_at, closed_at, updated_at)`, receita `SUM(sale_value)`) — não inventa receita nova, mantém paridade com o dashboard.

## Arquivos / artefatos tocados

**Migrations (5, idempotentes, backward-compat):**
- `supabase/migrations/20270101000000_org_unit_economics_inputs.sql` — **nova** tabela `org_unit_economics_inputs` (PK `organization_id, scenario`; scenario `dados`|`projecao`; colunas `anuncios/embalagem/frete/imposto_pct/admin_pct/recompras` + `meta_num_vendas/meta_ticket_medio` no cenário projeção). RLS **deny-all p/ não-master**: policies `master_select_all_*` e `master_all_*` gateadas em `is_master_user()` (WITH CHECK em escrita).
- `supabase/migrations/20270101000100_master_get_org_sales_summary.sql` — **nova** RPC `master_get_org_sales_summary(p_org_id, p_start, p_end) RETURNS jsonb`. `SECURITY DEFINER` com `search_path = public, extensions` (classe de hardening 42883/definer, NÃO `''`); gate `is_master_user()` antes de qualquer leitura.
- `supabase/migrations/20270101000200_master_org_sales_cohort.sql` — `CREATE OR REPLACE` da RPC acima adicionando o **CTE de coorte** (leads criados no período, não-deletados; conta distinct que venderam).
- `supabase/migrations/20270101000300_org_unit_economics_comissao.sql` — `ADD COLUMN comissao_pct` (DEFAULT 0, CAC inalterado em orgs existentes).
- `supabase/migrations/20270101000400_org_unit_economics_custo_produto_mc.sql` — `ADD COLUMN custo_por_produto / despesas_mode / margem_contribuicao_pct` + CHECK `despesas_mode IN ('detalhado','mc')`.

**Engine (puro, side-effect-free):**
- `src/modules/identity/master/lib/unit-economics.ts` — CAC bands, payback, LTV, curva de payback.
- `src/modules/identity/master/lib/economics-timeline.ts` — **novo**. Linha do tempo / curva J.
- `src/modules/identity/master/lib/*` (`jcurve-geometry`/`journey-geometry`, `format`).

**UI (`src/modules/identity/master/`):**
- `pages/MasterInsights.tsx`, `components/insights/InsightsContent.tsx`, `ExpenseInputsPanel.tsx`, `CacBandGauge.tsx`, `PaybackCard.tsx`, `UnitEconomicsJourneyChart.tsx` (substituiu `JCurveChart.tsx`), `OrgInsightsCombobox.tsx`, `InsightsHeader/ModeTabs/States/EmptyState`, `MetricStatRow.tsx`, `AutosaveIndicator.tsx`.
- `hooks/useOrgSalesSummary.ts`, `hooks/useOrgEconomicsInputs.ts`.
- `src/App.tsx` (rota `/insights` lazy), `src/modules/platform/components/layout/OrgSwitcher.tsx` (botão "Gestor"), `src/index.css` + `tailwind.config.ts` (token de cor `insights`).

**Specs / Testes:**
- `.specs/features/master-unit-economics/{BACKEND.md,DESIGN.md,JOURNEY-CHART-REDESIGN.md}`.
- `tests/unit/{unit-economics,economics-timeline,insights-helpers}.test.ts`, `tests/unit/master-insights-page.test.tsx`.

## PRs

- **#916** (`f5c42f2f`) — ferramenta master de unit economics (CAC, payback, linha do tempo). Base: `8cbd755d` (tela + bandas + curva) + `fe4eb038` (coorte + modelo CAC + timeline).
- **#919** (`31c305ff`) — engine de CAC alinhada à planilha do CTO. Base: `8d99a74a`.
- **#920** (`3129438d`) — custo por produto + modo margem de contribuição. Base: `28a4cafb` + review `0c0e1eab` (custo só no modo Detalhar; ghost MC efetiva).
- **#921** (`993c1918`) — rename botão/wordmark "Insights" → "Gestor". Base: `89ba255e`.

## Decisões

- **RLS por `is_master_user()`, não por org** — os pressupostos são do operador da plataforma, não do tenant. Master não tem `team_members`, então policies de isolamento por org o bloqueariam; deny-all para qualquer não-master.
- **Reusar a definição canônica de venda** do `get_dashboard_metrics` na RPC — evita divergência de receita entre Gestor e Dashboard.
- **`search_path = public, extensions` (não `''`)** nas funções DEFINER — segue o hardening da classe 42883 sem reintroduzir o modo de falha de resolução de nomes (cicatriz `leads_uf`).
- **Defaults backward-compat** em todo `ADD COLUMN` (comissão 0, custo produto 0, modo `detalhado`, MC 0) → cálculo idêntico ao anterior para orgs existentes.
- **Métrica por coorte** (não vendas brutas no período) — alinha o numerador de "quem comprou" ao funil de aquisição que o CAC mede.

## Impacto

- Master ganha visão de unit economics por org sem vazar pressupostos ao tenant.
- Zero impacto em orgs/usuários não-master: tabela e RPCs negam acesso fora de `is_master_user()`; nenhuma tela de tenant lê esses dados.
- 5 migrations novas (faixa `20270101*`). Confirmar aplicação em PROD (RPC + tabela) — migrations não autodeployam em merge.

## Follow-ups

- Verificar que as 5 migrations `20270101*` foram aplicadas em PROD (tabela `org_unit_economics_inputs` + RPC `master_get_org_sales_summary` com o CTE de coorte).
- Deploy do frontend (EasyPanel, pull `:latest`) para a rota `/insights` aparecer em prod.

## Links

- Feature: [[Master Operations]]
- Multi-tenancy / RLS: [[Multi-tenancy]] · [[RLS Policies]]
- Daily: [[2026-06-26]]
