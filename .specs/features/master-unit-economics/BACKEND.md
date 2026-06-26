# Master Unit Economics — Backend Contract

Ferramenta **MASTER-ONLY** de unit economics por organização. O operador da
plataforma (master, sem `team_member`) seleciona uma org arbitrária e calcula
CAC / Payback / curva de payback em J.

> Escopo deste doc: **backend + calc lib pura + hooks de dados**. A UI é
> implementada por outro agente contra a spec de design. Migrations **não
> aplicadas** (default dev), nada commitado.

## 1. Calc lib pura — `src/modules/identity/master/lib/unit-economics.ts`

Funções puras, sem I/O, 100% unit-testadas (`tests/unit/unit-economics.test.ts`).

```ts
interface UnitEconomicsInputs {
  ticketMedio; numVendas; anuncios; embalagem; frete;
  impostoPct; adminPct; recompras; horizonteMeses?; // default 12, clamp 3..120
}

computeCac(inputs)        → { faturamento, impostoValor, adminValor, despesasTotais, cacMaximo|null }
cacBands(cacMaximo)       → { cacMaximo, cacIdeal (max/2), cacMinimo (ideal/2) } | nulls
computeLtv(inputs)        → number (ticketMedio * recompras)
computePaybacks(inputs)   → { margemPorVenda, payback1, payback1Possivel, ltv, margemComLtv, payback2, payback2Possivel }
computePaybackCurve(inputs) → { defined, points[{mes,valor}], marks, model }
computeUnitEconomics(in)  → { cac, bands, paybacks, curve }  // agregador
```

Fórmulas (CTO-confirmadas): ver topo do arquivo. **CAC calculado É o teto**
(`cacMaximo = despesasTotais / numVendas`).

**Sentinelas defensivas (a UI precisa tratar):**
- `numVendas <= 0` → `cacMaximo = null`, bands null, `curve.defined = false`.
- `margemPorVenda <= 0` → `payback1 = null` + `payback1Possivel = false`; curva sem break-even (só desce).
- `margemComLtv <= 0` (inclui `recompras = 0`) → `payback2 = null` + `payback2Possivel = false`.
- Inputs não-finitos → coeridos a 0. Nunca retorna `NaN`/`Infinity`.

**Curva em J "ilustrativa ancorada":** marcos REAIS de um modelo mensal
(`investimentoMensal = despesasTotais`, `retornoMensalPleno = numVendas*margemPorVenda`,
rampa de maturação ~`recompras`); shape canônico suave (cosseno) passando por
`(0,0) → fundo ~breakEven/2 → 0 em breakEvenMes → pico`. Marcos expostos em
`curve.marks`: `maxCashConsumed`, `maxCashMes`, `breakEvenMes`, `selfFundingMes`,
`horizonteMeses`. Modelo em `curve.model`. Veja comentários no arquivo.

## 2. Tabela — `org_unit_economics_inputs`
Migration: `supabase/migrations/20270101000000_org_unit_economics_inputs.sql`

- PK `(organization_id, scenario)`. `scenario ∈ {'dados','projecao'}`.
- Custos: `anuncios, embalagem, frete numeric(14,2)`; `imposto_pct, admin_pct numeric(6,3)`; `recompras int`.
- Só `projecao` (nullable): `meta_num_vendas int`, `meta_ticket_medio numeric(14,2)`.
- `updated_by uuid default auth.uid()`, `created_at`, `updated_at` (trigger `update_updated_at_column`).
- FK `organization_id → organizations(id) ON DELETE CASCADE`.
- **RLS MASTER-ONLY**: policies `master_select_all_*` (SELECT) + `master_all_*`
  (ALL, USING+WITH CHECK) gateadas em `is_master_user()`. Deny-all p/ não-master.
  NÃO gateia em org membership (master não tem).

## 3. RPC — `master_get_org_sales_summary(p_org_id uuid, p_start date, p_end date)`
Migration: `supabase/migrations/20270101000100_master_get_org_sales_summary.sql`

- `SECURITY DEFINER`, `SET search_path = public, extensions` (classe hardening definer).
- Gate: `RAISE EXCEPTION 'forbidden: master only'` se `NOT is_master_user()` — antes de qualquer leitura.
- Retorna `jsonb`: `{ num_vendas, receita_total, ticket_medio, sale_values[], period_start, period_end }`.
- **Definição canônica de venda = `get_dashboard_metrics`**: `pipe_propostas`,
  `status='vendido'`, período `COALESCE(metrics_period_at, closed_at, updated_at)`,
  receita `SUM(COALESCE(sale_value,0))` (idêntico à série daily_sales). Bordas de
  dia inclusivas `[start, end+1d)`.
- `GRANT EXECUTE ... TO authenticated`; `REVOKE FROM PUBLIC, anon`.

## 4. Hooks de dados — `src/modules/identity/master/hooks/`
Exportados pelo barrel privado `src/modules/identity/master/index.ts`.

- `useOrgSalesSummary(orgId, start, end)` — RPC acima; `enabled: !!orgId && !!start && !!end`.
- `useOrgEconomicsInputs(orgId, scenario)` — `select().maybeSingle()` (null se inexistente).
- `useSaveOrgEconomicsInputs()` — `upsert` onConflict `organization_id,scenario`; invalida a query. Autosave-friendly (debounce na UI).
- **Seletor de org**: reusar `useMasterOrganizations()` (já existe) — não foi criado hook novo.

## Segurança
- RPC + tabela são deny-all a não-master: o gate é `is_master_user()` (SECURITY
  DEFINER, **pinada** por `20261227000000`). Sem caminho por org membership.
- RPC valida `is_master_user()` ANTES de ler. Tabela: RLS sem policy p/ não-master.
- Sem isso, membro comum poderia ler/forjar inputs ou dados de outra org → bloqueado.

## Pendências (fora do escopo deste agente)
- UI (outro agente, contra spec de design).
- Aplicar migrations em dev/prod (autorização CTO). Regenerar types após apply
  → remove os casts `as any` nos hooks.
- Commit/push (arquiteto).
