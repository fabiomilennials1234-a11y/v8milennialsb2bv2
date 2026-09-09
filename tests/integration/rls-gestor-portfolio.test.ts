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
import { TEST_PASSWORD } from './setup';
import {
  createFixtureOrganization,
  deleteFixtureOrganization,
} from './organization-fixture';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const GESTOR_EMAIL = 'gestor@test.com';
const GESTOR_ORG_ID = 'aabb0000-0000-0000-0000-000000009101';
const GESTOR_LEAD_ID = 'aabb0000-0000-0000-0000-000000009102';

describe.skipIf(shouldSkip)('RLS Gestor de Portfólio', () => {
  let service: SupabaseClient;
  let gestor: SupabaseClient;
  let gestorUserId: string;
  let gestorId: string;

  beforeAll(async () => {
    service = createServiceClient();

    await service.from('pipeline_entries').delete().eq('lead_id', GESTOR_LEAD_ID);
    await service.from('leads').delete().eq('id', GESTOR_LEAD_ID);
    await deleteFixtureOrganization(service, GESTOR_ORG_ID);
    await createFixtureOrganization(service, GESTOR_ORG_ID, 'Gestor RLS fixture');

    const { error: leadErr } = await service.from('leads').insert({
      id: GESTOR_LEAD_ID,
      name: 'Gestor isolated lead',
      organization_id: GESTOR_ORG_ID,
    });
    if (leadErr) throw new Error(`Falha ao criar lead do gestor: ${leadErr.message}`);

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

    // Ator gestor (fora de team_members) + vínculo à organização isolada.
    const { data: g, error: gErr } = await service
      .from('gestores')
      .insert({ user_id: gestorUserId, is_active: true })
      .select('id')
      .single();
    if (gErr) throw new Error(`Falha ao criar linha gestores: ${gErr.message}`);
    gestorId = g!.id;

    const { error: linkErr } = await service
      .from('gestor_organizations')
      .insert({ gestor_id: gestorId, organization_id: GESTOR_ORG_ID });
    if (linkErr) throw new Error(`Falha ao vincular gestor: ${linkErr.message}`);

    gestor = await createAuthenticatedClient(GESTOR_EMAIL);
  });

  afterAll(async () => {
    if (gestorId) await service.from('gestores').delete().eq('id', gestorId);
    if (gestorUserId) await service.auth.admin.deleteUser(gestorUserId);
    await service.from('pipeline_entries').delete().eq('lead_id', GESTOR_LEAD_ID);
    await service.from('leads').delete().eq('id', GESTOR_LEAD_ID);
    await deleteFixtureOrganization(service, GESTOR_ORG_ID);
  });

  // ── Tracer #1: gestor vinculado LÊ dado da org vinculada ──────────────
  it('gestor vinculado lê lead da organização vinculada', async () => {
    const { data, error } = await gestor
      .from('leads')
      .select('id')
      .eq('id', GESTOR_LEAD_ID);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(GESTOR_LEAD_ID);
  });
});
