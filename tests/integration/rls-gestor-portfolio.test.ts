// @vitest-environment node
/**
 * RLS integration tests — Gestor de Portfólio (S1 #1137, ADR-0021).
 *
 * Um Gestor de Portfólio é um "scoped Master": armazenado fora de `team_members`
 * (tabelas `gestores` + `gestor_organizations`), ganha acesso às orgs vinculadas
 * pela UNIÃO dessas orgs dentro de `get_my_organization_ids()` (read) e
 * `get_my_admin_organization_ids()` (admin-write).
 *
 * Prerequisites: `supabase start` + `supabase db reset` (seed cria orgA + orgB +
 * leads). O usuário gestor é criado no beforeAll via service_role (auth admin).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { createAuthenticatedClient, createServiceClient } from './rls-helpers';
import { TEST_ORG_B_ID, TEST_LEAD_ORGB_1_ID, TEST_PASSWORD } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const GESTOR_EMAIL = 'gestor@test.com';

describe.skipIf(shouldSkip)('RLS Gestor de Portfólio', () => {
  let service: SupabaseClient;
  let gestor: SupabaseClient;
  let gestorUserId: string;
  let gestorId: string;

  beforeAll(async () => {
    service = createServiceClient();

    // Cria o auth user do gestor (idempotente: apaga se já existir).
    const { data: existing } = await service.auth.admin.listUsers();
    const prior = existing?.users?.find((u) => u.email === GESTOR_EMAIL);
    if (prior) await service.auth.admin.deleteUser(prior.id);

    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email: GESTOR_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (createErr) throw new Error(`Falha ao criar gestor user: ${createErr.message}`);
    gestorUserId = created.user!.id;

    // Ator gestor (fora de team_members) + vínculo à orgB.
    const { data: g, error: gErr } = await service
      .from('gestores')
      .insert({ user_id: gestorUserId, is_active: true })
      .select('id')
      .single();
    if (gErr) throw new Error(`Falha ao criar linha gestores: ${gErr.message}`);
    gestorId = g!.id;

    await service
      .from('gestor_organizations')
      .insert({ gestor_id: gestorId, organization_id: TEST_ORG_B_ID });

    gestor = await createAuthenticatedClient(GESTOR_EMAIL);
  });

  afterAll(async () => {
    if (gestorId) await service.from('gestores').delete().eq('id', gestorId);
    if (gestorUserId) await service.auth.admin.deleteUser(gestorUserId);
  });

  // ── Tracer #1: gestor vinculado LÊ dado da org vinculada ──────────────
  it('gestor vinculado à orgB lê um lead da orgB', async () => {
    const { data, error } = await gestor
      .from('leads')
      .select('id')
      .eq('id', TEST_LEAD_ORGB_1_ID);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(TEST_LEAD_ORGB_1_ID);
  });
});
