// @vitest-environment node
/**
 * Marcador de autor-gestor no Chamado (ADR-0021 §9) — migration
 * `20270211000002_support_ticket_gestor_author.sql`.
 *
 * O que o guard protege, verificado contra a API (não contra a tela):
 *
 *   1. Gestor vinculado abre Chamado na org vinculada COM o marcador → OK.
 *   2. Um não-gestor NÃO consegue forjar o marcador (author_gestor_id de outro):
 *      o trigger levanta check_violation — um UPDATE/INSERT barrado por policy
 *      responderia 200, então a recusa precisa ser ruidosa.
 *   3. O marcador é imutável depois de gravado (não vira outro gestor).
 *
 * Prereqs: `supabase start` + `supabase db reset` aplica TODAS as migrations do
 * diretório — incluindo o swap de helpers (20270211000001) que dá ao gestor
 * acesso de escrita às orgs vinculadas, e este marcador (20270211000002). Em
 * prod ambas seguem pendentes do lote do CTO; localmente rodam.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  createAuthenticatedClient,
  createServiceClient,
  getOrgBMember,
  clearClients,
} from './rls-helpers';
import { TEST_ORG_B_ID, TEST_PASSWORD } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const GESTOR_EMAIL = 'gestor-author@test.com';
// orgA do seed — o gestor deste teste NÃO é vinculado a ela.
const TEST_ORG_A_ID = '00000000-0000-0000-0000-000000000001';

const baseTicket = {
  title: 'Kanban trava ao arrastar card',
  tipo: 'bug' as const,
  impacto: 'parado' as const,
};

describe.skipIf(shouldSkip)('Marcador de autor-gestor (support_tickets)', () => {
  let service: SupabaseClient;
  let gestor: SupabaseClient;
  let memberB: SupabaseClient;
  let gestorUserId: string;
  let gestorId: string;
  let markedTicketId: string;

  beforeAll(async () => {
    service = createServiceClient();

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

    const { data: g, error: gErr } = await service
      .from('gestores')
      .insert({ user_id: gestorUserId, is_active: true })
      .select('id')
      .single();
    if (gErr) throw new Error(`Falha ao criar linha gestores: ${gErr.message}`);
    gestorId = g!.id;

    // Vínculo à orgB apenas — orgA fica de fora de propósito.
    await service
      .from('gestor_organizations')
      .insert({ gestor_id: gestorId, organization_id: TEST_ORG_B_ID });

    gestor = await createAuthenticatedClient(GESTOR_EMAIL);
    memberB = await getOrgBMember();
  });

  afterAll(async () => {
    if (markedTicketId) await service.from('support_tickets').delete().eq('id', markedTicketId);
    if (gestorId) await service.from('gestores').delete().eq('id', gestorId);
    if (gestorUserId) await service.auth.admin.deleteUser(gestorUserId);
    clearClients();
  });

  // ── Tracer #1: gestor abre chamado na org vinculada, com marcador ──────────
  it('gestor vinculado abre Chamado na orgB carregando author_gestor_id', async () => {
    const { data, error } = await gestor
      .from('support_tickets')
      .insert({
        ...baseTicket,
        organization_id: TEST_ORG_B_ID,
        author_user_id: gestorUserId,
        author_gestor_id: gestorId,
      })
      .select('id, author_gestor_id, organization_id')
      .single();

    expect(error).toBeNull();
    expect(data?.author_gestor_id).toBe(gestorId);
    expect(data?.organization_id).toBe(TEST_ORG_B_ID);
    markedTicketId = data!.id;
  });

  // ── Tracer #2: gestor não consegue ancorar em org fora do vínculo ──────────
  it('gestor NÃO abre chamado na orgA (fora do vínculo)', async () => {
    const { error } = await gestor.from('support_tickets').insert({
      ...baseTicket,
      organization_id: TEST_ORG_A_ID,
      author_user_id: gestorUserId,
      author_gestor_id: gestorId,
    });
    // RLS insert (org não vinculada) e/ou o guard barram: a inserção falha.
    expect(error).not.toBeNull();
  });

  // ── Tracer #3: um não-gestor NÃO forja o marcador ─────────────────────────
  it('membro comum da orgB NÃO forja author_gestor_id de um gestor', async () => {
    const { error } = await memberB.from('support_tickets').insert({
      ...baseTicket,
      organization_id: TEST_ORG_B_ID,
      author_gestor_id: gestorId, // marcador de outra pessoa
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/author_gestor_id|check/i);
  });

  // ── Tracer #4: o marcador é imutável (não vira outro gestor) ───────────────
  it('o marcador não muda depois de gravado', async () => {
    // Cria um segundo gestor só para ter um id alvo diferente.
    const { data: g2 } = await service
      .from('gestores')
      .insert({ user_id: gestorUserId, is_active: false, notes: 'alvo' })
      .select('id')
      .maybeSingle();
    // UNIQUE(user_id) pode recusar; se recusar, o teste ainda vale com um uuid fixo.
    const otherGestorId = g2?.id ?? '00000000-0000-0000-0000-0000000009ff';

    const { error } = await gestor
      .from('support_tickets')
      .update({ author_gestor_id: otherGestorId })
      .eq('id', markedTicketId);

    expect(error).not.toBeNull();
    if (g2?.id) await service.from('gestores').delete().eq('id', g2.id);
  });
});
