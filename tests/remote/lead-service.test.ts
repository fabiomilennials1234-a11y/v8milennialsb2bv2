/**
 * Testes do lead-service contra um Supabase REMOTO — uma BRANCH EFÊMERA.
 *
 * Rodava contra PRODUÇÃO, criando organização lá, e vivia dentro do glob de
 * `npm run test:integration`. Ver `tests/remote/guard.ts` para a decisão.
 *
 * Rodar:
 *   # 1. crie a branch — .specs/project/runbook-validacao-local.md
 *   # 2. exporte o alvo (o guard RECUSA o ref de produção)
 *   TEST_SUPABASE_URL=https://<ref-da-branch>.supabase.co \
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=<chave-da-branch> \
 *   npm run test:remote
 *   # 3. ENCERRE a branch no mesmo ciclo
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  supabaseProd,
  ensureTestOrg,
  cleanupTestData,
  deleteTestOrg,
  INTEGRATION_TEST_ORG_NAME,
} from './setup-remote';
import {
  getOrCreateLead,
  normalizePhoneForSearch,
} from '../../supabase/functions/_shared/lead-service';

let testOrgId = '';

describe('lead-service — production integration', () => {
  beforeAll(async () => {
    testOrgId = await ensureTestOrg();
    console.log(`[test] Using test org: ${testOrgId}`);
    // Clean any leftover data from previous runs
    await cleanupTestData();
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    // Don't delete the org — reuse across runs
  }, 30000);

  // ── getOrCreateLead ────────────────────────────────

  it('creates a new lead when none exists', async () => {
    const result = await getOrCreateLead(supabaseProd, {
      organizationId: testOrgId,
      phone: '+55 48 99999-0001',
      name: 'Test Lead Alpha',
      origin: 'whatsapp',
    });

    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    expect(result!.source).toBe('created');
    expect(result!.lead.name).toBe('Test Lead Alpha');
    expect(result!.lead.organization_id).toBe(testOrgId);
  });

  it('finds existing lead by phone (deduplication)', async () => {
    // Same normalized phone as above: 48999990001
    const result = await getOrCreateLead(supabaseProd, {
      organizationId: testOrgId,
      phone: '48999990001', // Different format, same normalized
      name: 'Duplicate Lead',
    });

    expect(result).not.toBeNull();
    expect(result!.created).toBe(false);
    expect(result!.source).toBe('phone');
    expect(result!.lead.name).toBe('Test Lead Alpha'); // Original name preserved
  });

  it('creates lead by email when no phone match', async () => {
    const result = await getOrCreateLead(supabaseProd, {
      organizationId: testOrgId,
      email: 'test-integration@example.com',
      name: 'Email Lead',
      origin: 'meta_ads',
    });

    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    expect(result!.lead.name).toBe('Email Lead');
  });

  it('finds existing lead by email (deduplication)', async () => {
    const result = await getOrCreateLead(supabaseProd, {
      organizationId: testOrgId,
      email: 'TEST-INTEGRATION@example.com', // Different case
      name: 'Email Duplicate',
    });

    expect(result).not.toBeNull();
    expect(result!.created).toBe(false);
    expect(result!.source).toBe('email');
  });

  it('returns null when no phone and no email', async () => {
    const result = await getOrCreateLead(supabaseProd, {
      organizationId: testOrgId,
      name: 'No Contact',
    });

    expect(result).toBeNull();
  });

  it('returns null when no organizationId', async () => {
    const result = await getOrCreateLead(supabaseProd, {
      organizationId: '',
      phone: '11999999999',
    });

    expect(result).toBeNull();
  });

  it('creates lead with pushName fallback when no name', async () => {
    const result = await getOrCreateLead(supabaseProd, {
      organizationId: testOrgId,
      phone: '+55 11 98888-7777',
      pushName: 'WhatsApp Push Name',
    });

    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    expect(result!.lead.name).toBe('WhatsApp Push Name');
  });

  it('creates lead with auto-generated name when no name or pushName', async () => {
    const result = await getOrCreateLead(supabaseProd, {
      organizationId: testOrgId,
      phone: '+55 21 96666-5555',
    });

    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    // Auto-generated name includes last 4 digits of phone
    expect(result!.lead.name).toContain('5555');
  });

  // ── Organization isolation ─────────────────────────

  it('does not find leads from other organizations', async () => {
    // Create a lead in our test org
    await getOrCreateLead(supabaseProd, {
      organizationId: testOrgId,
      phone: '+55 11 91111-2222',
      name: 'Isolated Lead',
    });

    // Try to find it with a different (fake) org ID
    const result = await getOrCreateLead(supabaseProd, {
      organizationId: '00000000-0000-0000-0000-000000000000',
      phone: '+55 11 91111-2222',
      name: 'Cross-org attempt',
    });

    // Should create a new one (not find the one from test org)
    // This will fail if org 0000...0000 doesn't exist, which is expected
    // The point is it should NOT return Isolated Lead
    if (result) {
      expect(result.lead.organization_id).not.toBe(testOrgId);
    }
  });
});
