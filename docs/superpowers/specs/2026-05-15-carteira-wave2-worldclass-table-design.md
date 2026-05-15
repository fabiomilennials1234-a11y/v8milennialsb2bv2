# Wave 2 — Tabela World-Class (Carteira de Clientes)

> **Data:** 2026-05-15
> **Plano mãe:** `docs/superpowers/plans/2026-05-15-carteira-worldclass-waves.md`
> **Wave anterior:** Wave 1 (Dados Corretos) — deployed dev+prod
> **Status:** Aprovado

---

## Objetivo

Transformar a tabela principal da Carteira em uma ferramenta operacional: sorting server-side, paginacao server-side, KPIs via RPC dedicado, export CSV. Escala para 1000+ clientes sem degradacao.

## Decisao arquitetural

**Server-side desde o inicio.** Sorting + paginacao + filtros executam no Postgres via RPCs. Zero computacao JS para listas. TanStack Query gerencia cache com query keys granulares.

Razao: o plano original propunha sort client-side (W2.1) e depois migrar pra server-side (W2.3). Isso gera retrabalho. Implementar W2.3 primeiro elimina throwaway code.

---

## RPCs

### `get_portfolio_kpis(p_org_id UUID) RETURNS JSONB`

Aggregates puros. Uma query, zero JS.

```sql
RETURNS jsonb_build_object(
  'total_clients',      COUNT(*),
  'total_recurring',    COALESCE(SUM(avg_ticket), 0),
  'overdue_count',      COUNT(*) FILTER (WHERE days_since_last_order > reorder_cycle_days * 1.15),
  'overdue_revenue',    COALESCE(SUM(avg_ticket) FILTER (...), 0),
  'avg_health',         COALESCE(ROUND(AVG(health_score)), 0),
  'avg_ticket',         CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(avg_ticket)/COUNT(*)) ELSE 0 END,
  'expected_this_week', COUNT(*) FILTER (WHERE next_order_expected BETWEEN NOW() AND NOW() + '7d'),
  'segment_counts',     jsonb_build_object(
    'ouro', COUNT(*) FILTER (WHERE segment = 'ouro'),
    'prata', ..., 'novo', ..., 'resgate', ..., 'dormindo', ...
  )
)
FROM upsell_clients
WHERE organization_id = p_org_id AND is_active = true;
```

- LANGUAGE sql STABLE SECURITY DEFINER
- Alimenta: KPI cards, alert banner, tab badges, subtitle stats

### `get_portfolio_clients(...) RETURNS JSONB`

Lista paginada com sort + filter no Postgres.

**Parametros:**
| Param | Tipo | Default | Descricao |
|-------|------|---------|-----------|
| `p_org_id` | UUID | required | Organization ID |
| `p_filter` | TEXT | `'all'` | Tab filter: all, overdue, expected, ouro, prata, novo, resgate, dormindo |
| `p_search` | TEXT | `''` | Search query (name/company ILIKE) |
| `p_sort_by` | TEXT | `'name'` | Sort column (whitelist validado) |
| `p_sort_dir` | TEXT | `'asc'` | asc ou desc |
| `p_page` | INT | `1` | Pagina atual |
| `p_page_size` | INT | `50` | Itens por pagina |

**Sort columns permitidas:** `name`, `health_score`, `avg_ticket`, `days_since_last_order`, `next_order_expected`, `lifetime_value`, `order_count`

**Filtros:**
- `all` → sem filtro adicional
- `overdue` → `days_since_last_order > reorder_cycle_days * 1.15`
- `expected` → `next_order_expected BETWEEN NOW() AND NOW() + INTERVAL '7 days'`
- Segmentos → `segment = p_filter`

**Retorno:**
```json
{
  "rows": [...CarteiraClient],
  "total": 234,
  "page": 1,
  "page_size": 50,
  "total_pages": 5
}
```

- LANGUAGE plpgsql STABLE SECURITY DEFINER
- Dynamic ORDER BY via `EXECUTE format()` com whitelist (anti-injection)
- Search via `format(%L)` (safe quoting)

---

## Hooks

### `usePortfolioKPIs()`

```typescript
queryKey: ["portfolio-kpis", organizationId]
queryFn: supabase.rpc("get_portfolio_kpis", { p_org_id })
staleTime: 60_000
enabled: !!organizationId
```

Consumidores: `CarteiraKPIs`, `CarteiraAlertBanner`, `Upsell.tsx` (tab counts + subtitle)

### `usePortfolioClients(params)`

```typescript
queryKey: ["portfolio-clients", organizationId, { page, pageSize, sortBy, sortDir, filter, search }]
queryFn: supabase.rpc("get_portfolio_clients", { ...params })
staleTime: 30_000
enabled: !!organizationId
placeholderData: keepPreviousData  // transicao suave entre paginas
```

Consumidor unico: `CarteiraClientTable` (hook interno)

### `usePortfolioHealth()` — REMOVIDO

Todos consumidores migrados para `usePortfolioKPIs()` + `usePortfolioClients()`.

---

## UI: Sorting

- Headers clicaveis: name, health_score, avg_ticket, days_since_last_order, next_order_expected, lifetime_value, order_count
- Click cicla: none → asc → desc → none
- Indicador: `ArrowUpDown` (inativo), `ArrowUp` (asc), `ArrowDown` (desc)
- Coluna ativa: text-foreground. Inativas: text-muted-foreground
- Cursor pointer nos headers sortaveis
- Sort state: `{ sortBy: string | null, sortDir: 'asc' | 'desc' }` interno ao componente
- Default: sem sort (ordem natural do Postgres = insertion order)

## UI: Paginacao

- Barra bottom do container da tabela
- Layout: `"Mostrando 1-50 de 234"` | `[<- Anterior]` `Pagina 1 de 5` `[Proxima ->]`
- Previous disabled na page 1, Next disabled na ultima
- Reset page pra 1 quando filter/search/sort muda
- Estilo: border-t separator, padding consistente, text-muted-foreground para labels

## UI: Export CSV

- Botao ao lado do search input (area de toolbar)
- Icone `Download` + "Exportar"
- Variant `outline`, tamanho padrao
- On click: fetch ALL matching rows via `get_portfolio_clients` com `p_page_size: 10000`
- Gera CSV com headers: Nome, Empresa, Health, Segmento, Ticket Medio, Dias Atrasado, Proximo Pedido, LTV
- Download via `Blob('text/csv') + URL.createObjectURL + anchor.click()`
- Filename: `carteira-YYYY-MM-DD.csv`
- Loading state no botao durante fetch (spinner + disabled)
- Respeita filtro + search ativos (exporta dados filtrados, nao tudo)

---

## Fluxo de dados

```
Upsell.tsx
├── usePortfolioKPIs() → subtitle stats + tab counts (segment_counts)
├── CarteiraKPIs → usePortfolioKPIs() (TanStack dedup)
├── CarteiraAlertBanner → usePortfolioKPIs() (TanStack dedup)
└── CarteiraClientTable (filter, search as props)
    ├── sort/page state interno (useState)
    ├── usePortfolioClients({filter, search, sortBy, sortDir, page})
    ├── sortable headers
    ├── pagination bar
    └── export button → fetch sem paginacao → CSV blob
```

## Arquivos

| Arquivo | Acao |
|---------|------|
| `supabase/migrations/XXXX_portfolio_rpcs.sql` | Novo: 2 RPCs + GRANT EXECUTE |
| `src/hooks/usePortfolioKPIs.ts` | Novo |
| `src/hooks/usePortfolioClients.ts` | Novo |
| `src/hooks/usePortfolioHealth.ts` | Removido |
| `src/components/carteira/CarteiraKPIs.tsx` | Migrar pra usePortfolioKPIs() |
| `src/components/carteira/CarteiraAlertBanner.tsx` | Migrar pra usePortfolioKPIs() |
| `src/components/carteira/CarteiraClientTable.tsx` | Sort + pagination + export + hook interno |
| `src/pages/Upsell.tsx` | Migrar pra usePortfolioKPIs(), remover client list management |

## Ordem de implementacao

1. Migration (RPCs)
2. Hook `usePortfolioKPIs`
3. Hook `usePortfolioClients`
4. Migrar `CarteiraKPIs` + `CarteiraAlertBanner`
5. Refatorar `CarteiraClientTable` (hook interno + sort + pagination + export)
6. Migrar `Upsell.tsx`
7. Remover `usePortfolioHealth.ts`
8. Testar end-to-end

## Criterio de conclusao

- Tabela ordena por qualquer coluna sortavel (7 colunas)
- Paginacao funcional com 50/pagina
- KPIs carregam via RPC (instantaneo, independente da tabela)
- CSV exporta dados filtrados
- Zero regressao em filtros, search, tabs, preview sidebar
- `usePortfolioHealth` eliminado do codebase
