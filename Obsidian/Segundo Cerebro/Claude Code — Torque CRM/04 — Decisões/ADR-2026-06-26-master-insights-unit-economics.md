---
type: adr
title: "Unit economics master-only por org"
status: accepted
created: 2026-06-26
updated: 2026-06-26
tags: [adr, insights, unit-economics, master, cac, multi-tenant]
related: ["[[2026-06-26-insights-unit-economics]]", "[[2026-06-26-onboarding-hub-build-decouple]]", "[[ADR-2026-06-22-torque-mcp-interno]]", "[[Multi-tenancy]]", "[[RLS Policies]]", "[[Schema]]", "[[RPCs]]"]
owner: gabriel
supersedes: []
superseded_by: []
---

# ADR-2026-06-26 — Unit economics master-only por org

**Data:** 2026-06-26
**Status:** accepted
**Escopo:** módulo `identity/master` (área `/insights`, rótulo de UI "Gestor"); RPC + tabela em `public`; classe de segurança master-only / master-ghost.

> Não há ADR no repo (`docs/adr/` vai até `0013-workflow-builder-mcp-declarative-dsl.md`) cobrindo unit economics — este ADR do vault é o **registro canônico** da decisão. Changelog operacional: [[2026-06-26-insights-unit-economics]].

## Contexto

O operador da plataforma (Gabriel, role `master`) precisa avaliar a saúde econômica de uma org **arbitrária** — CAC, payback, LTV, curva de recuperação de caixa — para decidir investimento de tráfego e diagnosticar orgs no prejuízo. Nada na plataforma respondia "quanto custa adquirir um cliente nesta org e em quantas compras o CAC se paga".

Duas tensões concretas dispararam a decisão:

1. **A parede master-ghost.** O `master` é super-admin transversal **sem `team_members`**. Toda RPC/policy de leitura gateada por pertencimento à org (`get_my_organization_ids()`, `auth.org_id()`) o **bloqueia silenciosamente** — classe de bug recorrente no projeto (chat vazio, lixeira sem master, disparo "nenhum lead", checklists invisíveis). Uma ferramenta que lê vendas de qualquer org **tem** de gatear em `is_master_user()`, nunca em membership.

2. **Definição de "venda" tinha de bater com o resto do produto.** Inventar uma métrica de receita nova produziria números que divergem do Dashboard e da aba Saúde do funil — exatamente o que mina a confiança numa ferramenta de decisão financeira. O primeiro corte (vendas *fechadas* no período, âncora `closed_at`) mostrava 12 contra os 8 da aba Saúde. Precisava de uma definição **única e canônica**.

Decidir agora (em vez de empilhar mais um relatório ad-hoc) evita: (a) reintroduzir a parede master-ghost numa superfície nova; (b) deixar o conceito de "venda" derivar; (c) deixar pressupostos de custo (que **não** são dados do tenant) vazarem para a RLS por org.

## Forças em jogo

**Restrições do CTO:**
- Modelo de CAC **alinhado à planilha do CTO** (revisões #919/#920): CAC real = despesas rateadas por venda; teto = ticket médio (break-even); ideal = ticket/2; mínimo = ticket/4. Payback expresso em **nº de compras**, não em meses.
- Métrica de vendas = **COORTE** (leads criados no período que compraram), espelhando `get_funnel_health` / aba Saúde — mesmo número, mesma fonte.
- Comissão do vendedor entra no CAC como % do faturamento.

**Restrições técnicas:**
- Engine de cálculo **pura** (zero I/O, zero React, determinística) para ser auditável e unit-testável — a UI consome cada sub-termo.
- Reusar a definição canônica de receita do Dashboard (`get_dashboard_metrics`, `20261215000000`): `pipe_propostas`/`pipeline_entries` status `vendido`, `sale_value` em `metadata->>'sale_value'`.
- Sem dep nova de chart (curva desenhada em SVG bespoke + framer-motion).

**Restrições de segurança/multi-tenant:**
- `master` lê org arbitrária → cross-tenant **por design**. Único gate aceitável: `is_master_user()` (pinada pelo hardening dinâmico `20261227000000`), nunca org membership.
- Pressupostos de custo digitados pelo master **não** são dados do tenant → tabela **deny-all** para qualquer não-master (membros/admins não leem nem forjam).
- RPC `SECURITY DEFINER` com `search_path` pinado em `public, extensions` (classe 42883/definer) — **não** `''` (cicatriz do incidente `leads_uf`, que falha na resolução de nomes não-qualificados sob caller hardened).
- Toda policy de escrita carrega `WITH CHECK` (anti-escalada de privilégio).

## Opções consideradas

### Opção (a) — Estender o Analytics existente (por org logada)
Vantagem: reusa dashboards e RLS por org já prontos.
Desvantagem (vetada): o `master` **não pertence** à org → a parede master-ghost zeraria tudo; e não há fluxo para o master escolher uma org arbitrária. Errado para a persona.

### Opção (b) — Área master-only `/insights` + RPC master-scoped + tabela de pressupostos RLS master-only ⭐ ESCOLHIDA
Vantagem: gate único em `is_master_user()` (sem reintroduzir master-ghost); pressupostos isolados do tenant; receita reusa a definição canônica do Dashboard; engine pura testável.
Desvantagem: cross-tenant concentrado numa RPC — a corretude do gate `is_master_user()` pinado é o ponto crítico de segurança.

### Opção (c) — Pressupostos de custo guardados nas próprias tabelas do tenant
Vantagem: reusa RLS por org.
Desvantagem (vetada): custos digitados pelo master são pressupostos de análise, **não** dados do tenant — guardá-los sob a org os exporia a admins do tenant e confundiria fonte de verdade. Domínios separados.

## Decisão

**Adotada opção (b).** Sub-decisões:

### D1 — Métrica canônica = COORTE de vendas
A base é a **coorte**: leads `created_at` no período (não-deletados) que viraram venda (`pipeline_entries.stage_key = 'vendido'` no pipe system `propostas`). Espelha `get_funnel_health.stages.compraram` → o número da aba Dados = o da aba Saúde. Ressalva registrada no código: coortes recentes ainda maturam (CAC recente fica superestimado até a coorte converter). Migration `20270101000200_master_org_sales_cohort.sql` reescreve a RPC de "vendas fechadas" → "coorte".

### D2 — Modelo de CAC por bandas + payback por nº de compras
Engine pura `src/modules/identity/master/lib/unit-economics.ts`:
- `cacAtual = despesasTotais / numVendas` (CAC real — a agulha do gauge; pode ultrapassar o teto = prejuízo).
- `despesasTotais = anuncios + embalagem + frete + impostoValor + adminValor + comissaoValor`.
- Bandas-alvo derivadas do **ticket médio** (teto break-even): `cacMaximo = ticketMedio`, `cacIdeal = ticket/2`, `cacMinimo = ticket/4`.
- Payback em **nº de compras**: `payback1 = cacAtual / margemPorVenda`; `payback2 = cacAtual / margemComLtv` (com `ltv = ticketMedio * recompras`).
- Contrato defensivo: divisões guardadas retornam `null` (nunca `NaN`/`Infinity`); cenários impossíveis (numVendas=0, ticket≤0, margem≤0) → `null` + flag.

### D3 — RPC master-scoped `master_get_org_sales_summary(p_org_id, p_start, p_end)`
`SECURITY DEFINER`, `SET search_path = public, extensions`, gate `IF NOT public.is_master_user() THEN RAISE EXCEPTION 'forbidden: master only'` **antes** de qualquer leitura. Sem fallback por org membership. `REVOKE ALL` de `PUBLIC`/`anon`, `GRANT EXECUTE` só a `authenticated`. Receita reusa a definição canônica do Dashboard. Evita a parede master-ghost por construção.

### D4 — Tabela `org_unit_economics_inputs` RLS master-only (deny-all não-master)
PK composta `(organization_id, scenario)`, `scenario ∈ {'dados','projecao'}` (what-if sobrescreve `meta_num_vendas`/`meta_ticket_medio`). Colunas de custo: `anuncios`, `embalagem`, `frete`, `imposto_pct`, `admin_pct`, `comissao_pct` (adicionada em `20270101000300`), `recompras`. RLS: `SELECT` e `ALL` gateados em `public.is_master_user()` com `WITH CHECK`; nenhuma policy para não-master = **deny-all efetivo**. `GRANT` apenas habilita o role; a RLS é a fronteira.

### D5 — Acesso e chrome próprios
Botão azul "Gestor" (antes "Insights", renomeado em #921) no `OrgSwitcher`; rota top-level `/insights` (`src/App.tsx:698`), lazy `MasterInsights` (`App.tsx:106`), **fora** do `MasterLayout`, com token semântico `--insights`. Abas Dados | Projeção. Migrations default **dev**; aplicar em prod = autorização CTO explícita.

## Consequências

### Positivas
- O `master` calcula unit economics de qualquer org sem reintroduzir master-ghost — gate único e auditável.
- Número de vendas **idêntico** à aba Saúde (mesma coorte) → confiança na ferramenta.
- Engine pura → cada termo intermediário é auditável e unit-testável sem Docker/React.
- Pressupostos de custo isolados do tenant (deny-all) — sem vazamento de PII analítica.
- RPC segue a classe de hardening definer (`search_path` pinado), não repete a cicatriz `leads_uf`.

### Negativas
- Cross-tenant concentrado numa RPC: a corretude depende inteiramente do gate `is_master_user()` pinado continuar pinado (regressão de RLS/hardening reabriria a leitura).
- CAC de coorte recente é **superestimado** até a coorte maturar (venda cujo lead entrou no mês anterior conta no mês de ENTRADA) — risco de leitura precipitada.
- `types.ts` não regenerado na entrega inicial → casts `as any` na fronteira Supabase (#916).

### Pendências geradas
- HIGH: reconciliar ledger `schema_migrations` em prod — `20270101000200`/`000300` foram aplicadas em prod via Mgmt API (autorização CTO p/ teste) à frente do merge; confirmar `20270101000000`/`000100` em prod e que o repo não reverte o gate.
- MEDIUM: regenerar `types.ts` e remover os casts `as any`.
- LOW: o squash do #916 arrastou imports de `OnboardingHub` para `App.tsx` com 4 arquivos untracked → Build Image quebrou; resolvido por decouple (#918) e re-commit dos arquivos (#917) — ver [[2026-06-26-onboarding-hub-build-decouple]].

## Alternativas rejeitadas

- **Estender Analytics por org logada** — a parede master-ghost zeraria os dados; persona errada.
- **Métrica = vendas fechadas no período** (`closed_at`) — divergia da aba Saúde (12 vs 8); substituída por coorte em `20270101000200`.
- **Pressupostos nas tabelas do tenant** — custos do master não são dados do tenant; exporia a admins e confundiria fonte de verdade.
- **`search_path = ''` na RPC** — modo de falha 42883 sob caller hardened (incidente `leads_uf`); pinado em `public, extensions`.

## Evidência (PRs / SHAs / migrations)

**Migrations** (`supabase/migrations/`):
- `20270101000000_org_unit_economics_inputs.sql` — tabela `org_unit_economics_inputs`, RLS master-only (`is_master_user()`), PK `(organization_id, scenario)`, `WITH CHECK`, deny-all não-master.
- `20270101000100_master_get_org_sales_summary.sql` — RPC `SECURITY DEFINER`, `search_path public, extensions`, gate `is_master_user()`, receita canônica do Dashboard (`pipe_propostas` status `vendido`).
- `20270101000200_master_org_sales_cohort.sql` — reescreve a RPC para **coorte** (leads `created_at` × `pipeline_entries.stage_key='vendido'` no pipe system `propostas`), espelha `get_funnel_health`.
- `20270101000300_org_unit_economics_comissao.sql` — `ADD COLUMN comissao_pct numeric(6,3) NOT NULL DEFAULT 0`.

**Commits / PRs** (`git log --all`):
- `8cbd755d` feat(insights): tela master-only de unit economics por org (CAC, payback, curva J) — scaffold.
- `fe4eb038` feat(insights): coorte de vendas, modelo CAC e linha do tempo de unit economics.
- `f5c42f2f` (#916) feat(insights): ferramenta master de unit economics por organização (CAC, payback, linha do tempo).
- `31c305ff` (#919) feat(insights): alinhar engine de CAC ao modelo da planilha do CTO.
- `3129438d` (#920) feat(insights): custo por produto + modo margem de contribuição no painel de despesas.
- `993c1918` (#921) chore(insights): renomeia botão e wordmark 'Insights' → 'Gestor'.
- `8cae494c` (#918) fix(build): decouple unshipped OnboardingHub from App.tsx to unblock deploy.
- `35761aa4` (#917) fix(build): commit missing OnboardingHub files referenced by App.tsx.

**Código:**
- Engine pura: `src/modules/identity/master/lib/unit-economics.ts` (CAC, bandas, payback por nº de compras, curva J defensiva).
- Linha do tempo: `src/modules/identity/master/lib/economics-timeline.ts`; chart `components/insights/UnitEconomicsJourneyChart.tsx`; gauge `components/insights/CacBandGauge.tsx`.
- Rota/área: `src/App.tsx:106` (lazy `MasterInsights`), `src/App.tsx:698` (`/insights`); page `src/modules/identity/master/pages/MasterInsights`.
- Hooks: `src/modules/identity/master/hooks/useOrgSalesSummary.ts`, `useOrgEconomicsInputs.ts`.

**Classes de segurança referenciadas:**
- `20261227000000` — hardening dinâmico de `SECURITY DEFINER` / pin de `search_path` (pina `is_master_user()`).
- `20261215000000` — `get_dashboard_metrics` (definição canônica de receita reusada).
