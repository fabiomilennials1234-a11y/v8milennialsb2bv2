import { describe, it, expect } from 'vitest';

/**
 * Pure-function tests for the data transformation logic used by
 * MktUtmBreakdown and useMktByOrigin — no React rendering needed.
 *
 * These functions mirror the computation in the components to ensure
 * the mapping from RPC data → display rows is correct.
 */

// ── Campaign mapping (mirrors MktUtmBreakdown useMemo) ──────────────

interface UtmCombinedRow {
  name: string;
  totalLeads: number;
  converted: number;
  conversionRate: number;
}

interface CampaignRow {
  campaign: string;
  leads: number;
  vendas: number;
  conversion: number;
}

function mapCampaigns(items: UtmCombinedRow[]): CampaignRow[] {
  if (!items?.length) return [];
  return items
    .filter((item) => item.totalLeads > 0)
    .map((item): CampaignRow => ({
      campaign: item.name,
      leads: item.totalLeads,
      vendas: item.converted,
      conversion: item.conversionRate,
    }))
    .sort((a, b) => b.leads - a.leads);
}

describe('MktUtmBreakdown — campaign mapping', () => {
  it('maps RPC items to display rows sorted by leads desc', () => {
    const input: UtmCombinedRow[] = [
      { name: 'campaign_a', totalLeads: 10, converted: 2, conversionRate: 20 },
      { name: 'campaign_b', totalLeads: 50, converted: 5, conversionRate: 10 },
      { name: 'campaign_c', totalLeads: 30, converted: 9, conversionRate: 30 },
    ];

    const result = mapCampaigns(input);

    expect(result).toHaveLength(3);
    expect(result[0].campaign).toBe('campaign_b');
    expect(result[0].leads).toBe(50);
    expect(result[0].vendas).toBe(5);
    expect(result[1].campaign).toBe('campaign_c');
    expect(result[2].campaign).toBe('campaign_a');
  });

  it('filters out campaigns with zero leads', () => {
    const input: UtmCombinedRow[] = [
      { name: 'active', totalLeads: 15, converted: 3, conversionRate: 20 },
      { name: 'empty', totalLeads: 0, converted: 0, conversionRate: 0 },
    ];

    const result = mapCampaigns(input);

    expect(result).toHaveLength(1);
    expect(result[0].campaign).toBe('active');
  });

  it('returns empty array for null/empty input', () => {
    expect(mapCampaigns([])).toEqual([]);
    expect(mapCampaigns(null as any)).toEqual([]);
    expect(mapCampaigns(undefined as any)).toEqual([]);
  });

  it('handles single campaign correctly', () => {
    const input: UtmCombinedRow[] = [
      { name: 'solo', totalLeads: 100, converted: 25, conversionRate: 25 },
    ];

    const result = mapCampaigns(input);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      campaign: 'solo',
      leads: 100,
      vendas: 25,
      conversion: 25,
    });
  });

  it('preserves conversion rate from RPC (does not recalculate)', () => {
    const input: UtmCombinedRow[] = [
      { name: 'test', totalLeads: 3, converted: 1, conversionRate: 33.3 },
    ];

    const result = mapCampaigns(input);

    expect(result[0].conversion).toBe(33.3);
  });
});

// ── Origin grouping (mirrors useMktByOrigin logic) ──────────────────

interface LeadLite {
  id: string;
  origin: string | null;
  created_at: string;
  metrics_period_at: string | null;
}

const ALL_ORIGINS = [
  'whatsapp', 'meta_ads', 'instagram', 'tiktok', 'google_ads',
  'site', 'landing_page', 'remarketing', 'indicacao', 'evento',
  'prospeccao_ativa', 'cal', 'outro',
] as const;

type LeadOrigin = (typeof ALL_ORIGINS)[number];

function groupLeadsByOrigin(
  leads: LeadLite[],
  filterStart: string,
  filterEnd: string,
): Record<string, LeadLite[]> {
  const inRange = (s: string | null | undefined) =>
    s != null && s >= filterStart && s <= filterEnd;

  const leadsByPeriod = leads.filter(
    (l) =>
      (l.metrics_period_at != null && inRange(l.metrics_period_at)) ||
      (l.metrics_period_at == null && inRange(l.created_at))
  );

  const grouped: Record<string, LeadLite[]> = {};
  ALL_ORIGINS.forEach((o) => (grouped[o] = []));
  leadsByPeriod.forEach((l) => {
    const origin = l.origin ?? 'outro';
    const bucket = ALL_ORIGINS.includes(origin as LeadOrigin) ? origin : 'outro';
    grouped[bucket].push(l);
  });

  return grouped;
}

describe('useMktByOrigin — lead grouping by origin', () => {
  const start = '2026-04-01T00:00:00.000Z';
  const end = '2026-04-30T23:59:59.999Z';

  it('groups leads by origin within date range', () => {
    const leads: LeadLite[] = [
      { id: '1', origin: 'meta_ads', created_at: '2026-04-10T10:00:00Z', metrics_period_at: null },
      { id: '2', origin: 'meta_ads', created_at: '2026-04-15T10:00:00Z', metrics_period_at: null },
      { id: '3', origin: 'whatsapp', created_at: '2026-04-20T10:00:00Z', metrics_period_at: null },
      { id: '4', origin: 'google_ads', created_at: '2026-04-05T10:00:00Z', metrics_period_at: null },
    ];

    const result = groupLeadsByOrigin(leads, start, end);

    expect(result['meta_ads']).toHaveLength(2);
    expect(result['whatsapp']).toHaveLength(1);
    expect(result['google_ads']).toHaveLength(1);
    expect(result['site']).toHaveLength(0);
  });

  it('excludes leads outside the date range', () => {
    const leads: LeadLite[] = [
      { id: '1', origin: 'meta_ads', created_at: '2026-03-31T23:59:59Z', metrics_period_at: null },
      { id: '2', origin: 'meta_ads', created_at: '2026-04-01T00:00:01Z', metrics_period_at: null },
      { id: '3', origin: 'meta_ads', created_at: '2026-05-01T00:00:01Z', metrics_period_at: null },
    ];

    const result = groupLeadsByOrigin(leads, start, end);

    expect(result['meta_ads']).toHaveLength(1);
    expect(result['meta_ads'][0].id).toBe('2');
  });

  it('prefers metrics_period_at over created_at for date filtering', () => {
    const leads: LeadLite[] = [
      {
        id: '1',
        origin: 'meta_ads',
        created_at: '2026-03-15T10:00:00Z',
        metrics_period_at: '2026-04-10T10:00:00Z',
      },
      {
        id: '2',
        origin: 'meta_ads',
        created_at: '2026-04-15T10:00:00Z',
        metrics_period_at: '2026-03-10T10:00:00Z',
      },
    ];

    const result = groupLeadsByOrigin(leads, start, end);

    // Lead 1: metrics_period_at in range → included
    // Lead 2: metrics_period_at out of range → excluded (even though created_at in range)
    expect(result['meta_ads']).toHaveLength(1);
    expect(result['meta_ads'][0].id).toBe('1');
  });

  it('maps unknown origins to "outro"', () => {
    const leads: LeadLite[] = [
      { id: '1', origin: 'unknown_source', created_at: '2026-04-10T10:00:00Z', metrics_period_at: null },
      { id: '2', origin: null, created_at: '2026-04-10T10:00:00Z', metrics_period_at: null },
    ];

    const result = groupLeadsByOrigin(leads, start, end);

    expect(result['outro']).toHaveLength(2);
  });

  it('handles empty leads array', () => {
    const result = groupLeadsByOrigin([], start, end);

    ALL_ORIGINS.forEach((origin) => {
      expect(result[origin]).toHaveLength(0);
    });
  });

  it('counts all origins correctly with mixed data', () => {
    const leads: LeadLite[] = ALL_ORIGINS.map((origin, i) => ({
      id: `lead-${i}`,
      origin,
      created_at: '2026-04-10T10:00:00Z',
      metrics_period_at: null,
    }));

    const result = groupLeadsByOrigin(leads, start, end);

    ALL_ORIGINS.forEach((origin) => {
      expect(result[origin]).toHaveLength(1);
    });
  });
});
