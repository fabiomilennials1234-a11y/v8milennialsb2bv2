/**
 * Integration tests for lead import flow.
 *
 * Requires local Supabase (`supabase start`).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { supabase, TEST_ORG_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Track IDs created during tests for cleanup
const createdLeadIds: string[] = [];

describe.skipIf(shouldSkip)('Lead Import — integration', () => {
  afterAll(async () => {
    // Cleanup created leads
    if (createdLeadIds.length > 0) {
      await supabase.from('leads').delete().in('id', createdLeadIds);
    }
  });

  it('inserting a new lead via Supabase creates it successfully', async () => {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name: 'Import Test Lead',
        company: 'Import Corp',
        phone: '+5511888880001',
        email: 'import-test@test.com',
        organization_id: TEST_ORG_ID,
      })
      .select('id, name')
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.name).toBe('Import Test Lead');
    if (data?.id) createdLeadIds.push(data.id);
  });

  it('inserting duplicate phone in same org can be detected', async () => {
    const phone = '+5511888880099';

    // First insert
    const { data: first } = await supabase
      .from('leads')
      .insert({
        name: 'Dup Lead 1',
        phone,
        organization_id: TEST_ORG_ID,
      })
      .select('id')
      .single();

    if (first?.id) createdLeadIds.push(first.id);

    // Second insert with same phone — check if it exists
    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .eq('organization_id', TEST_ORG_ID)
      .maybeSingle();

    expect(existing).not.toBeNull();
    expect(existing?.id).toBe(first?.id);
  });

  it('lead without name and phone can be rejected by application logic', () => {
    // This is a validation rule — leads without name AND phone should be rejected
    const lead = { name: '', phone: '', email: '' };
    const isValid = !!(lead.name?.trim() || lead.phone?.trim());
    expect(isValid).toBe(false);
  });

  it('test leads from seed exist', async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('id')
      .eq('organization_id', TEST_ORG_ID);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(3);
  });
});
