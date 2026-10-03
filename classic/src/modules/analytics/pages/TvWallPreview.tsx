/**
 * /tv-wall-preview — HARNESS DE PIXEL da parede (#1254 acabamento, fatia harness).
 *
 * Irmã de /tv-renderers-demo e /tv-type-scale: dev-only (nega em produção), sem
 * auth, sem DB. A DIFERENÇA: renderiza a `TVComposableWall` REAL (grid + WidgetFrame
 * + buildEyebrow reais) alimentada por um SNAPSHOT-FIXTURE, não renderers isolados.
 * Os 3 defeitos de acabamento moram na PAREDE MONTADA (altura de grid, largura de
 * célula, eyebrow de razão) — as demos de renderer isolado os perdiam.
 *
 * MECANISMO (sem tocar hook de produção): semeia o cache do React Query num
 * QueryClient próprio (staleTime Infinity → nunca refetch → nunca toca supabase).
 * O team-member semeado dá orgId à useOrganization; as queries downstream
 * (dashboard-pages, dashboard-snapshot, metric-catalog) batem no fixture.
 *
 * A Bancada dirige a validação (Playwright tests/e2e/tv-wall-pixel.spec.ts). O
 * fixture CONTÉM os casos que quebram — se nascer verde, está cego.
 */
import { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TVComposableWall } from "@/modules/analytics/components/tv/composable/TVComposableWall";
import type { DashboardSnapshot } from "@/modules/analytics/hooks/useDashboardSnapshot";

const ORG_ID = "00000000-0000-4000-8000-000000000abc";
const PAGE_ID = "00000000-0000-4000-8000-000000000f01";
const TM_ID = "00000000-0000-4000-8000-000000000f02";

/** Catálogo: labels humanos. leads_criados/reunioes_marcadas OMITIDOS de propósito
 *  (widget D prova o fallback cru do ramo ratio do buildEyebrow). */
const CATALOG = {
  measures: [
    { id: "receita", label: "Receita" },
    { id: "num_vendas", label: "Nº de vendas" },
    { id: "leads_na_etapa", label: "Leads na etapa" },
  ],
  recortes: [
    { id: "total", label: "Total" },
    { id: "etapa", label: "Etapa" },
  ],
  formats: [],
  ratios: [{ num: "receita", den: "num_vendas", label: "Ticket médio" }],
  renderers: [],
};

/** Snapshot-fixture: 3 que quebram + 1 guarda-verde (C) + D (fallback cru).
 *  Espec exata da Bancada. */
const SNAPSHOT: DashboardSnapshot = {
  disabled: false,
  page_id: PAGE_ID,
  widgets: [
    // A — CARD ALTO VAZIO (RED assert 2): escalar num grid h=4 → ~70% de vão.
    {
      widget_id: "a", measure_kind: "leaf", recorte_id: "total", widget_style: null,
      format_id: "currency_brl", value_format: "currency_brl", weight: "primary",
      grid: { col: 0, row: 0, w: 3, h: 4 }, filters: {},
      measure: { kind: "leaf", measure_id: "receita", unit: "currency", currency: "BRL", recorte: "total", value: 86468, series: null } as any,
    },
    // B — RAZÃO EM CÉLULA ESTREITA (RED assert 1 e 3): R$ 14.411 e eyebrow truncam em w=2.
    {
      widget_id: "b", measure_kind: "ratio", recorte_id: "total", widget_style: null,
      format_id: "currency_brl", value_format: "currency_brl", weight: "primary",
      grid: { col: 9, row: 0, w: 2, h: 1 }, filters: {},
      measure: { kind: "ratio", unit: "currency", currency: "BRL", value: 14411.33,
        num: { measure_id: "receita", value: 86468, unit: "currency" },
        den: { measure_id: "num_vendas", value: 6, unit: "count" } } as any,
    },
    // C — ETAPA DEGRADADA (GREEN nos 3): recorte EFETIVO 'total' (motor degradou).
    // Esperado: eyebrow "Leads na etapa" SEM "por etapa"; chartType number, não barra vazia.
    {
      widget_id: "c", measure_kind: "leaf", recorte_id: "etapa", widget_style: null,
      format_id: "integer", value_format: "integer", weight: "primary",
      grid: { col: 3, row: 0, w: 5, h: 3 }, filters: {},
      measure: { kind: "leaf", measure_id: "leads_na_etapa", unit: "count", recorte: "total", value: 2151, series: null } as any,
    },
    // D — FALLBACK CRU (RED assert 3): num/den SEM label no catálogo → "leads_criados / reunioes_marcadas".
    {
      widget_id: "d", measure_kind: "ratio", recorte_id: "total", widget_style: null,
      format_id: "percent_1", value_format: "percent_1", weight: "secondary",
      grid: { col: 9, row: 1, w: 2, h: 1 }, filters: {},
      measure: { kind: "ratio", unit: "percent", value: 12.5,
        num: { measure_id: "leads_criados", value: 6, unit: "count" },
        den: { measure_id: "reunioes_marcadas", value: 48, unit: "count" } } as any,
    },
    // E — FUNIL (P2): ordem preservada, taxa entre etapas, rampa quente. Não re-ordena por volume.
    {
      widget_id: "e", measure_kind: "leaf", recorte_id: "etapa", widget_style: "funnel", style_variant: "bars",
      format_id: "integer", value_format: "integer", weight: "primary",
      grid: { col: 3, row: 3, w: 5, h: 3 }, filters: {},
      measure: { kind: "leaf", measure_id: "leads_na_etapa", unit: "count", recorte: "etapa", value: null,
        series: [
          { key: "novo", label: "Novo", value: 1000 },
          { key: "contato", label: "Contato", value: 620 },
          { key: "proposta", label: "Proposta", value: 240 },
          { key: "ganho", label: "Ganho", value: 90 },
        ] } as any,
    },
  ],
};

function seed(qc: QueryClient) {
  // team-member: dá orgId à useOrganization (user null → user?.id undefined).
  qc.setQueryData(["team_members", "current", undefined, false, false], {
    id: TM_ID, organization_id: ORG_ID, organizationId: ORG_ID, role: "admin", is_active: true, name: "QA",
  });
  qc.setQueryData(["organization-type", ORG_ID], { org_type: "crm", timezone: "America/Sao_Paulo" });
  qc.setQueryData(["composable-metrics-enabled", ORG_ID], true);
  qc.setQueryData(["metric-catalog"], CATALOG);
  qc.setQueryData(["dashboard-pages", ORG_ID, "tv"], [
    { id: PAGE_ID, title: "Fechamento", position: 0, rotation_seconds: 20 },
  ]);
  qc.setQueryData(["dashboard-snapshot", ORG_ID, PAGE_ID, "month", null, null, null], SNAPSHOT);
}

export default function TvWallPreview() {
  // Dev-only: some do bundle de produção como as irmãs.
  if (!import.meta.env.DEV) {
    return <div style={{ padding: 40, fontFamily: "sans-serif" }}>Não disponível em produção.</div>;
  }

  const qc = useMemo(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
    });
    seed(client);
    return client;
  }, []);

  return (
    <QueryClientProvider client={qc}>
      {/* data-surface tv liga os tokens de TV (--tv, --chart, --metric-ramp).
          A parede renderiza standalone quando o layout assenta (o gate NÃO é o
          shell de auth — é o TIMING; o spec espera fonts.ready + geometria estável
          antes de medir). Tamanho fixo 1920x1080 pro Playwright fotografar. */}
      <div data-surface="tv" data-testid="tv-wall-root" className="dark" style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "hsl(var(--background))" }}>
        <TVComposableWall period="month" />
      </div>
    </QueryClientProvider>
  );
}
