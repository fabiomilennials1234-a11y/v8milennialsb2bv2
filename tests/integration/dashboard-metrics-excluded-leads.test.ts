/**
 * get_dashboard_metrics × leads.excluded_from_metrics
 *
 * Clientes importados por planilha em pipeline custom (import-leads,
 * destination=custom_pipeline) nascem com excluded_from_metrics=true e ficam
 * fora do totalLeads do Dashboard principal. Lead comum (default false) conta.
 *
 * Usa org DEDICADA (não TEST_ORG_ID): a asserção é de contagem org-wide exata
 * e os arquivos de integração rodam em paralelo inserindo leads na org
 * compartilhada — delta exato lá seria flaky.
 *
 * Requires local Supabase (`supabase start`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

let orgId: string;

/** totalLeads do mês corrente (UTC) — mesmo recorte do useDashboardMetrics. */
async function fetchTotalLeads(): Promise<number> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  ).toISOString();
  const { data, error } = await supabase.rpc('get_dashboard_metrics', {
    p_org_id: orgId,
    p_start_date: start,
    p_end_date: end,
    p_filter_member_id: null,
  });
  expect(error).toBeNull();
  const raw = Array.isArray(data) ? data[0] : data;
  return (raw as { totalLeads: number }).totalLeads;
}

describe.skipIf(shouldSkip)('get_dashboard_metrics — excluded_from_metrics', () => {
  beforeAll(async () => {
    const { data, error } = await supabase
      .from('organizations')
      .insert({ name: `dashboard-excluded-metrics-org-${Date.now()}` })
      .select('id')
      .single();
    expect(error).toBeNull();
    orgId = data!.id;
  });

  afterAll(async () => {
    if (!orgId) return;
    await supabase.from('leads').delete().eq('organization_id', orgId);
    await supabase.from('organizations').delete().eq('id', orgId);
  });

  it('lead com excluded_from_metrics=true não entra no totalLeads', async () => {
    expect(await fetchTotalLeads()).toBe(0);

    const { error } = await supabase.from('leads').insert({
      name: 'Cliente Importado Funil Custom',
      organization_id: orgId,
      excluded_from_metrics: true,
    });
    expect(error).toBeNull();

    expect(await fetchTotalLeads()).toBe(0);
  });

  it('lead comum (default false) segue contando no totalLeads', async () => {
    const before = await fetchTotalLeads();

    const { error } = await supabase.from('leads').insert({
      name: 'Lead Orgânico Dashboard',
      organization_id: orgId,
    });
    expect(error).toBeNull();

    expect(await fetchTotalLeads()).toBe(before + 1);
  });
});
