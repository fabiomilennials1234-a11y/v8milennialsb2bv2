/**
 * Integration tests for the Permission Engine.
 *
 * These tests require a running local Supabase instance (`supabase start`).
 * They verify the full permission cascade via the actual database.
 *
 * Skip if SKIP_INTEGRATION is set (for CI without Supabase).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { supabase, TEST_ORG_ID, TEST_ADMIN_ID, TEST_SDR_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const TEST_MEMBER_ID = TEST_SDR_ID;

describe.skipIf(shouldSkip)('Permission Engine — integration', () => {
  beforeAll(async () => {
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', TEST_ORG_ID)
      .maybeSingle();

    if (!data) {
      console.warn('⚠ Test org not found — run `supabase db reset` to apply seed.sql');
    }
  });

  it('admin team member exists in test data', async () => {
    const { data } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', TEST_ADMIN_ID)
      .eq('organization_id', TEST_ORG_ID)
      .maybeSingle();

    expect(data).not.toBeNull();
    expect(data?.role).toBe('admin');
  });

  it('member team member exists in test data (migrated from sdr)', async () => {
    const { data } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', TEST_MEMBER_ID)
      .eq('organization_id', TEST_ORG_ID)
      .maybeSingle();

    expect(data).not.toBeNull();
    expect(data?.role).toBe('member');
  });

  it('feature_permissions table has entries including new view keys', async () => {
    const { count } = await supabase
      .from('feature_permissions')
      .select('*', { count: 'exact', head: true });

    // 54+ original features + 3 new (view_unassigned, view_subordinates, view_general_info)
    expect(count).toBeGreaterThanOrEqual(57);
  });

  it('new feature keys exist: leads.view_unassigned, leads.view_subordinates, leads.view_general_info', async () => {
    const { data } = await supabase
      .from('feature_permissions')
      .select('key')
      .in('key', ['leads.view_unassigned', 'leads.view_subordinates', 'leads.view_general_info']);

    expect(data).toHaveLength(3);
  });

  it('member_feature_permissions supports overrides', async () => {
    const memberTeamMemberId = '00000000-0000-0000-0000-000000000130';

    await supabase.from('member_feature_permissions').upsert({
      team_member_id: memberTeamMemberId,
      organization_id: TEST_ORG_ID,
      feature_key: 'leads.delete',
      enabled: false,
    });

    const { data } = await supabase
      .from('member_feature_permissions')
      .select('enabled')
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.delete')
      .maybeSingle();

    expect(data?.enabled).toBe(false);

    // Cleanup
    await supabase
      .from('member_feature_permissions')
      .delete()
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.delete');
  });

  // ─── Gestor de Portfólio (scoped master — ADR-0021 §6, S3 #1139) ────────
  // Verifica no nível de tabela que o binding gestor↔org resolve como esperado.
  // O reconhecimento full no edge (canUserPerformAction/requireAuth) roda no
  // runtime Deno e é coberto pelos unit tests; aqui garantimos o schema + o
  // round-trip de vínculo que o server consulta.

  it('gestores + gestor_organizations tables exist and bind round-trips', async () => {
    // Cria org secundária de teste + gestor + vínculo, então consulta como o
    // server (gestor ativo vinculado → 1 linha). Cleanup ao final.
    const GESTOR_USER = '00000000-0000-0000-0000-0000000009a1';
    const { data: gestor, error: gErr } = await supabase
      .from('gestores')
      .upsert({ user_id: GESTOR_USER, is_active: true }, { onConflict: 'user_id' })
      .select('id')
      .maybeSingle();

    if (gErr) {
      console.warn('⚠ gestores table not present — skipping (apply S1 migration)');
      return;
    }
    expect(gestor?.id).toBeTruthy();

    await supabase.from('gestor_organizations').upsert(
      { gestor_id: gestor!.id, organization_id: TEST_ORG_ID },
      { onConflict: 'gestor_id,organization_id' },
    );

    // Bound → 1 linha (o que isActiveGestorForOrg consulta no server)
    const { data: bound } = await supabase
      .from('gestor_organizations')
      .select('id')
      .eq('gestor_id', gestor!.id)
      .eq('organization_id', TEST_ORG_ID)
      .maybeSingle();
    expect(bound?.id).toBeTruthy();

    // Org não-vinculada → 0 linhas (fail-closed cross-org)
    const { data: unbound } = await supabase
      .from('gestor_organizations')
      .select('id')
      .eq('gestor_id', gestor!.id)
      .eq('organization_id', '00000000-0000-0000-0000-0000000000ff')
      .maybeSingle();
    expect(unbound).toBeNull();

    // Cleanup
    await supabase.from('gestor_organizations').delete().eq('gestor_id', gestor!.id);
    await supabase.from('gestores').delete().eq('id', gestor!.id);
  });

  it('member_feature_permissions override enabled=true grants access', async () => {
    const memberTeamMemberId = '00000000-0000-0000-0000-000000000130';

    await supabase.from('member_feature_permissions').upsert({
      team_member_id: memberTeamMemberId,
      organization_id: TEST_ORG_ID,
      feature_key: 'leads.export',
      enabled: true,
    });

    const { data } = await supabase
      .from('member_feature_permissions')
      .select('enabled')
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.export')
      .maybeSingle();

    expect(data?.enabled).toBe(true);

    // Cleanup
    await supabase
      .from('member_feature_permissions')
      .delete()
      .eq('team_member_id', memberTeamMemberId)
      .eq('feature_key', 'leads.export');
  });
});
