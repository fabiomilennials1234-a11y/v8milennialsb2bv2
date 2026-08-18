// @vitest-environment node
/**
 * Camada de default por organização (#1630, PRD #1629).
 *
 * PROBLEMA: `feature_permissions` é catálogo GLOBAL — não tem
 * `organization_id`. O único ponto de ajuste por org era
 * `member_feature_permissions`, que é POR MEMBRO. Consequências:
 *
 *   - o admin precisa desligar uma permissão membro a membro;
 *   - todo contratado novo entra herdando o `default_value` GLOBAL,
 *     desfazendo em silêncio a política que a org escolheu.
 *
 * A camada nova resolve entre as duas: override do membro vence o default da
 * org, que vence o catálogo global.
 *
 * Fixture (supabase/seed.sql):
 *   Member1 (TM 140) tem override explícito leads.view_all=false
 *   Member2 (TM 150) tem override explícito leads.view_all=true
 *   Member B (TM 170, Org B) NÃO tem override nenhum — é quem prova a camada
 *   `leads.view_all` tem default_value=true no catálogo global
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  getOrgAAdmin,
  getOrgAMember1,
  getOrgAMember2,
  getOrgBAdmin,
  getOrgBMember,
  getMaster,
  clearClients,
  createServiceClient,
} from './rls-helpers';
import { TEST_ORG_ID, TEST_ORG_B_ID } from './setup';

const KEY = 'leads.view_all';
const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

async function effective(client: SupabaseClient, orgId: string, key = KEY): Promise<boolean> {
  const { data, error } = await client.rpc('has_feature_permission', {
    p_feature_key: key,
    p_org_id: orgId,
  });
  if (error) throw new Error(`has_feature_permission falhou: ${error.message}`);
  return data === true;
}

describe.skipIf(shouldSkip)('Default de feature por organização', () => {
  let service: SupabaseClient;
  let adminA: SupabaseClient;
  let member1: SupabaseClient;
  let member2: SupabaseClient;
  let adminB: SupabaseClient;
  let memberB: SupabaseClient;
  let master: SupabaseClient;

  beforeAll(async () => {
    [adminA, member1, member2, adminB, memberB, master] = await Promise.all([
      getOrgAAdmin(),
      getOrgAMember1(),
      getOrgAMember2(),
      getOrgBAdmin(),
      getOrgBMember(),
      getMaster(),
    ]);
    service = createServiceClient();
  });

  beforeEach(async () => {
    await service.from('organization_feature_defaults').delete().in('organization_id', [
      TEST_ORG_ID,
      TEST_ORG_B_ID,
    ]);
  });

  afterAll(async () => {
    await service.from('organization_feature_defaults').delete().in('organization_id', [
      TEST_ORG_ID,
      TEST_ORG_B_ID,
    ]);
    await clearClients();
  });

  // ---------------------------------------------------------------
  // Precedência
  // ---------------------------------------------------------------

  describe('precedência: membro > org > catálogo global', () => {
    it('sem default da org, vale o catálogo global — controle positivo', async () => {
      // leads.view_all tem default_value=true no catálogo.
      expect(await effective(memberB, TEST_ORG_B_ID)).toBe(true);
    });

    it('default da org sobrepõe o catálogo global', async () => {
      await service
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_B_ID, feature_key: KEY, enabled: false });

      expect(await effective(memberB, TEST_ORG_B_ID)).toBe(false);
    });

    it('override do membro sobrepõe o default da org', async () => {
      // Org A com default false; Member2 tem override explícito true.
      await service
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: false });

      expect(await effective(member2, TEST_ORG_ID)).toBe(true); // override vence
      expect(await effective(member1, TEST_ORG_ID)).toBe(false); // override também false
    });

    it('override do membro vale mesmo quando o default da org é permissivo', async () => {
      await service
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: true });

      expect(await effective(member1, TEST_ORG_ID)).toBe(false); // override false vence
    });

    it('o default é POR ORG — a Org A não afeta a Org B', async () => {
      await service
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: false });

      expect(await effective(memberB, TEST_ORG_B_ID)).toBe(true);
    });

    it('admin continua com tudo, independente do default da org', async () => {
      await service
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: false });

      expect(await effective(adminA, TEST_ORG_ID)).toBe(true);
    });

    it('master continua com tudo', async () => {
      await service
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: false });

      expect(await effective(master, TEST_ORG_ID)).toBe(true);
    });

    it('feature admin-only continua negada ao membro, mesmo com default da org ligado', async () => {
      await service.from('organization_feature_defaults').insert({
        organization_id: TEST_ORG_ID,
        feature_key: 'voip.session.manage',
        enabled: true,
      });

      expect(await effective(member1, TEST_ORG_ID, 'voip.session.manage')).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // O buraco que a camada fecha
  // ---------------------------------------------------------------

  describe('contratado novo herda a política da org', () => {
    it('membro sem override nenhum recebe o default da org, não o global', async () => {
      // Member B não tem linha em member_feature_permissions. Antes desta
      // camada ele herdava o catálogo global (true) e a política da org era
      // desfeita em silêncio a cada contratação.
      expect(await effective(memberB, TEST_ORG_B_ID)).toBe(true); // controle positivo

      await service
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_B_ID, feature_key: KEY, enabled: false });

      expect(await effective(memberB, TEST_ORG_B_ID)).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // Quem escreve
  // ---------------------------------------------------------------

  describe('RLS da tabela de defaults', () => {
    it('admin da org grava o default da própria org', async () => {
      const { error } = await adminA
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: false });
      expect(error).toBeNull();
    });

    it('membro NÃO grava', async () => {
      const { error } = await member1
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: false });
      expect(error).not.toBeNull();
    });

    it('admin de outra org NÃO grava na Org A', async () => {
      const { error } = await adminB
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: false });
      expect(error).not.toBeNull();
    });

    it('membro LÊ o default da própria org — a UI precisa mostrar o efetivo', async () => {
      await service
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: false });

      const { data, error } = await member1
        .from('organization_feature_defaults')
        .select('feature_key, enabled')
        .eq('organization_id', TEST_ORG_ID);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('membro NÃO lê o default de outra org', async () => {
      await service
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_B_ID, feature_key: KEY, enabled: false });

      const { data } = await member1
        .from('organization_feature_defaults')
        .select('feature_key')
        .eq('organization_id', TEST_ORG_B_ID);

      expect(data).toHaveLength(0);
    });

    it('a mudança fica registrada em permission_audit_log', async () => {
      await adminA
        .from('organization_feature_defaults')
        .insert({ organization_id: TEST_ORG_ID, feature_key: KEY, enabled: false });

      const { data } = await service
        .from('permission_audit_log')
        .select('table_name, permission_key, new_enabled')
        .eq('organization_id', TEST_ORG_ID)
        .eq('table_name', 'organization_feature_defaults')
        .order('created_at', { ascending: false })
        .limit(1);

      expect(data).toHaveLength(1);
      expect(data![0].permission_key).toBe(KEY);
      expect(data![0].new_enabled).toBe(false);
    });
  });
});
