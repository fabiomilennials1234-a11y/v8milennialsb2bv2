/**
 * crm-mcp C2 — PAT resolver + table RLS anchor (.specs/features/crm-mcp/DESIGN.md §7).
 *
 * Covers the DB security surface of the PAT infra that runs in CI `integration-tests`
 * (local Supabase + seed + migrations applied):
 *   - crm_mcp_resolve_token is hermetic (identity-only on exact hash, empty on miss) and
 *     folds is_master + current active org ids;
 *   - the PAT table RLS isolates owners, lets org admins govern, and master-ghosts;
 *   - the immutability trigger freezes hash/owner/org/scopes/audience.
 *
 * NOT covered here (it is the DEPLOY-TIME canary, DESIGN §8.7): the full HTTP edge
 * round-trip — a minted per-user ES256 JWT reading leads scoped to its org, a master PAT
 * → 403, an anon-no-bearer → zero rows. That requires the target project's JWKS to TRUST
 * the crm-mcp ES256 public key (a deploy prerequisite), so it is validated by the boot
 * round-trip canary at deploy, not in this DB-only suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { clearClients, createServiceClient, getMaster, getOrgAAdmin, getOrgBMember } from './rls-helpers';

const ORG_B = '00000000-0000-0000-0000-000000000002';
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

// ⚠ SUÍTE PENDENTE — a feature NÃO EXISTE (SCRUM-425).
//
// Medido em produção em 2026-08-21: não há `personal_access_tokens` nem
// `crm_mcp_resolve_token`. Nenhuma migration do repo as cria, e o catálogo de
// prod também não as tem. Isto aqui é a fatia C2 do crm-mcp escrita a partir do
// DESIGN.md — ESPECIFICAÇÃO, não regressão.
//
// `describe.skip` e não deleção: o teste é o contrato acordado da fatia, e
// apagá-lo perderia o desenho de segurança já pensado (resolver hermético,
// RLS por dono, master-ghost, imutabilidade do hash). Quando a migration da
// C2 entrar, tirar o `.skip` é a primeira coisa a fazer — e ele vai reprovar
// até a implementação bater com o contrato, que é o ponto.
//
// Deixá-lo rodando manteria o job de Integration vermelho para sempre por uma
// feature que ninguém começou, e portão que nasce vermelho é portão que
// ninguém lê.
describe.skip('crm-mcp: PAT resolver + table RLS (feature não construída — SCRUM-425)', () => {
  const svc = createServiceClient();
  let userId: string;
  let patId: string;
  // Token shape is irrelevant to the RPC (it matches on the hash only).
  const token = 'tq_mcp_test_' + 'a'.repeat(30) + '000000';
  const hash = sha256hex(token);

  beforeAll(async () => {
    const memberb = await getOrgBMember();
    const { data: u } = await memberb.auth.getUser();
    userId = u.user!.id;

    const { data, error } = await svc
      .from('personal_access_tokens')
      .insert({
        organization_id: ORG_B,
        user_id: userId,
        name: 'crm-mcp anchor',
        token_hash: hash,
        token_prefix: token.slice(0, 20),
        expires_at: '2099-01-01T00:00:00Z',
      })
      .select('id')
      .single();
    if (error) throw new Error(`seed pat: ${error.message}`);
    patId = data.id;
  });

  afterAll(async () => {
    if (patId) await svc.from('personal_access_tokens').delete().eq('id', patId);
    await clearClients();
  });

  it('crm_mcp_resolve_token: exact hash → identity + is_master=false + current org ids', async () => {
    const { data, error } = await svc.rpc('crm_mcp_resolve_token', { p_hash: hash });
    expect(error).toBeNull();
    const row = (data as any[])[0];
    expect(row.user_id).toBe(userId);
    expect(row.organization_id).toBe(ORG_B);
    expect(row.audience).toBe('crm-mcp');
    expect(row.is_master).toBe(false);
    expect(row.current_org_ids).toContain(ORG_B);
    expect(row.revoked_at).toBeNull();
  });

  it('crm_mcp_resolve_token: non-matching hash → no row (hermetic, no existence oracle)', async () => {
    const { data } = await svc.rpc('crm_mcp_resolve_token', { p_hash: sha256hex('not-a-real-token') });
    expect((data as any[] ?? []).length).toBe(0);
  });

  it('PAT table RLS: owner sees own token; an Org A admin cannot; master ghosts it', async () => {
    const memberb = await getOrgBMember();
    const adminA = await getOrgAAdmin();
    const master = await getMaster();

    const { data: own } = await memberb
      .from('personal_access_tokens').select('id').eq('id', patId).maybeSingle();
    expect(own?.id).toBe(patId);

    const { data: foreign } = await adminA
      .from('personal_access_tokens').select('id').eq('id', patId).maybeSingle();
    expect(foreign).toBeNull(); // cross-org isolation

    const { data: ghost } = await master
      .from('personal_access_tokens').select('id').eq('id', patId).maybeSingle();
    expect(ghost?.id).toBe(patId); // master-ghost from day 1
  });

  it('immutability trigger: changing a frozen column (scopes) is rejected even for service_role', async () => {
    const { error } = await svc
      .from('personal_access_tokens')
      .update({ scopes: ['read', 'write'] })
      .eq('id', patId);
    expect(error).not.toBeNull(); // trigger fires regardless of RLS
  });

  it('owner can revoke (set revoked_at) — the one allowed UPDATE', async () => {
    const memberb = await getOrgBMember();
    const { error } = await memberb
      .from('personal_access_tokens')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user' })
      .eq('id', patId);
    expect(error).toBeNull();
  });
});
