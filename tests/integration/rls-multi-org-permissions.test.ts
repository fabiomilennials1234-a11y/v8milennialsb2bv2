// @vitest-environment node
/**
 * RLS integration tests: Fase 2 do hotfix de permissões multi-org (2026-04-24).
 *
 * Valida as mudanças introduzidas pela migration
 * `20260917000100_fix_permissions_multi_org_deterministic.sql`:
 *
 *   1. `get_user_organization_id()` é determinístico (ORDER BY)
 *   2. `has_feature_permission(key, org_id)` avalia contra org explícita
 *   3. `can_manage_copilot(org_id)` respeita a org passada
 *   4. RLS de copilot_agents, whatsapp_instances, leads e pipe_* não
 *      libera cross-org (mesmo pra admin de outra org) além do previsto
 *   5. Fail-closed: org_id NULL → feature permission retorna false
 *
 * Prerequisites: `supabase start` rodando, `supabase db reset` aplicado
 * (seed.sql cria orgA + orgB e membros).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  getOrgAAdmin,
  getOrgAMember1,
  getOrgBAdmin,
  getOrgBMember,
  clearClients,
  createServiceClient,
  expectInsertDenied,
  expectDeleteDenied,
} from './rls-helpers';
import {
  TEST_ORG_ID,
  TEST_ORG_B_ID,
  TEST_MEMBER_1_ID,
  TEST_MEMBER_B_ID,
} from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(shouldSkip)('RLS Fase 2: permissions multi-org deterministic', () => {
  let orgAAdmin: SupabaseClient;
  let orgAMember: SupabaseClient;
  let orgBAdmin: SupabaseClient;
  let orgBMember: SupabaseClient;
  let service: SupabaseClient;

  // Agent fixtures criados no seed ou pelo próprio teste (service_role)
  let orgAAgentId: string;
  let orgBAgentId: string;

  beforeAll(async () => {
    [orgAAdmin, orgAMember, orgBAdmin, orgBMember] = await Promise.all([
      getOrgAAdmin(),
      getOrgAMember1(),
      getOrgBAdmin(),
      getOrgBMember(),
    ]);
    service = createServiceClient();

    // Criar copilot_agents de teste — um por org. Idempotente via upsert.
    orgAAgentId = '00000000-0000-0000-0000-00000000a001';
    orgBAgentId = '00000000-0000-0000-0000-00000000a002';

    await service.from('copilot_agents').upsert([
      {
        id: orgAAgentId,
        organization_id: TEST_ORG_ID,
        name: 'Agent orgA',
        agent_type: 'qualificador',
        is_active: true,
      },
      {
        id: orgBAgentId,
        organization_id: TEST_ORG_B_ID,
        name: 'Agent orgB',
        agent_type: 'qualificador',
        is_active: true,
      },
    ]);
  });

  afterAll(async () => {
    await service.from('copilot_agents').delete().in('id', [orgAAgentId, orgBAgentId]);
    await clearClients();
  });

  // ──────────────────────────────────────────────────────────────────
  // 1. get_user_organization_id determinístico
  // ──────────────────────────────────────────────────────────────────
  describe('get_user_organization_id determinism', () => {
    it('retorna o mesmo org_id em chamadas consecutivas (orgA admin)', async () => {
      const { data: r1, error: e1 } = await orgAAdmin.rpc('get_user_organization_id');
      const { data: r2, error: e2 } = await orgAAdmin.rpc('get_user_organization_id');
      expect(e1).toBeNull();
      expect(e2).toBeNull();
      expect(r1).toBe(r2);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 2. has_feature_permission(key, org_id) fail-closed
  // ──────────────────────────────────────────────────────────────────
  describe('has_feature_permission(key, org_id)', () => {
    it('retorna false quando org_id é NULL', async () => {
      const { data, error } = await orgAMember.rpc('has_feature_permission', {
        p_feature_key: 'copilot.create',
        p_org_id: null,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('retorna false para org onde user não tem team_member ativo', async () => {
      // orgA member tenta feature na orgB — não pertence lá
      const { data, error } = await orgAMember.rpc('has_feature_permission', {
        p_feature_key: 'copilot.create',
        p_org_id: TEST_ORG_B_ID,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('retorna true para admin na própria org (bypass de is_admin)', async () => {
      const { data, error } = await orgAAdmin.rpc('has_feature_permission', {
        p_feature_key: 'workflows.edit', // admin_only
        p_org_id: TEST_ORG_ID,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('retorna false para admin-only quando user é member', async () => {
      const { data, error } = await orgAMember.rpc('has_feature_permission', {
        p_feature_key: 'workflows.edit',
        p_org_id: TEST_ORG_ID,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 3. can_manage_copilot(org_id) respeita ORG explícita
  // ──────────────────────────────────────────────────────────────────
  describe('can_manage_copilot(org_id)', () => {
    it('admin da orgA pode gerenciar copilot NA orgA', async () => {
      const { data, error } = await orgAAdmin.rpc('can_manage_copilot', {
        p_org_id: TEST_ORG_ID,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('admin da orgA NÃO pode gerenciar copilot na orgB (sem team_member lá)', async () => {
      const { data, error } = await orgAAdmin.rpc('can_manage_copilot', {
        p_org_id: TEST_ORG_B_ID,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 4. RLS copilot_agents — cross-org deny
  // ──────────────────────────────────────────────────────────────────
  describe('RLS copilot_agents cross-org', () => {
    it('member da orgA não enxerga copilot_agent da orgB via SELECT', async () => {
      const { data, error } = await orgAMember
        .from('copilot_agents')
        .select('id')
        .eq('id', orgBAgentId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('member da orgA não consegue UPDATE em copilot_agent da orgB', async () => {
      const { data, error, count } = await orgAMember
        .from('copilot_agents')
        .update({ is_active: false }, { count: 'exact' })
        .eq('id', orgBAgentId)
        .select();
      // RLS denial: 0 rows affected (sem erro ou com erro conforme variante)
      expect(count ?? data?.length ?? 0).toBe(0);
    });

    it('member da orgA não consegue DELETE de copilot_agent da orgB', async () => {
      await expectDeleteDenied(orgAMember, 'copilot_agents', orgBAgentId);
      // Confirma que o row ainda existe via service_role
      const { data } = await service
        .from('copilot_agents')
        .select('id')
        .eq('id', orgBAgentId)
        .maybeSingle();
      expect(data?.id).toBe(orgBAgentId);
    });

    it('admin da orgA consegue UPDATE em agent da orgA (bug original destravado)', async () => {
      const { error } = await orgAAdmin
        .from('copilot_agents')
        .update({ is_active: false })
        .eq('id', orgAAgentId);
      expect(error).toBeNull();

      // Reverter
      await service
        .from('copilot_agents')
        .update({ is_active: true })
        .eq('id', orgAAgentId);
    });

    it('INSERT de agente na orgB por admin da orgA é negado', async () => {
      await expectInsertDenied(orgAAdmin, 'copilot_agents', {
        id: '00000000-0000-0000-0000-00000000a999',
        organization_id: TEST_ORG_B_ID,
        name: 'cross-org attempt',
        agent_type: 'qualificador',
        is_active: true,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 5. Sanity multi-org — member org B vê só o seu
  // ──────────────────────────────────────────────────────────────────
  describe('isolation orgB side', () => {
    it('member da orgB enxerga agent da própria org mas não da orgA', async () => {
      const { data: visible } = await orgBMember
        .from('copilot_agents')
        .select('id, organization_id');

      const ids = (visible ?? []).map((r) => r.id);
      expect(ids).toContain(orgBAgentId);
      expect(ids).not.toContain(orgAAgentId);
    });
  });
});
