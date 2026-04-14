/**
 * Integration test setup — connects to PRODUCTION Supabase.
 *
 * Uses an isolated test organization that does NOT interact with real customer data.
 * All test data is created in beforeAll and cleaned up in afterAll.
 *
 * IMPORTANT: This setup uses the service_role key for full access.
 * The test org is completely isolated via organization_id scoping.
 */

import { createClient } from '@supabase/supabase-js';

const PROD_SUPABASE_URL = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
const PROD_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzanNtdW5jZmtic2J6cXpxaGZxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTIxODc4MSwiZXhwIjoyMDg0Nzk0NzgxfQ.dcAGjeVLcMIh2x2JRdCYFmD_6Gtp8cdVxg4hL1dNz2w';

export const supabaseProd = createClient(PROD_SUPABASE_URL, PROD_SERVICE_ROLE_KEY);

// Test org ID — created by ensureTestOrg(), cleaned up by cleanupTestOrg()
export const INTEGRATION_TEST_ORG_NAME = '__integration_test_org__';
export let INTEGRATION_TEST_ORG_ID = '';

/**
 * Creates an isolated test organization in production.
 * Returns the org ID. Safe to call multiple times (idempotent).
 */
export async function ensureTestOrg(): Promise<string> {
  // Check if test org already exists
  const { data: existing } = await supabaseProd
    .from('organizations')
    .select('id')
    .eq('name', INTEGRATION_TEST_ORG_NAME)
    .maybeSingle();

  if (existing) {
    INTEGRATION_TEST_ORG_ID = existing.id;
    return existing.id;
  }

  // Create new test org
  const { data: newOrg, error } = await supabaseProd
    .from('organizations')
    .insert({
      name: INTEGRATION_TEST_ORG_NAME,
      slug: 'integration-test-org',
      subscription_status: 'trial',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create test org: ${error.message}`);

  INTEGRATION_TEST_ORG_ID = newOrg.id;
  return newOrg.id;
}

/**
 * Cleans up all test data created during integration tests.
 * Deletes in correct FK order to avoid constraint violations.
 */
export async function cleanupTestData(): Promise<void> {
  if (!INTEGRATION_TEST_ORG_ID) return;

  const tables = [
    'lead_tags',
    'lead_history',
    'conversation_messages',
    'conversations',
    'pipe_whatsapp',
    'pipe_confirmacao',
    'pipe_propostas',
    'custom_pipe_entries',
    'workflow_execution_steps',
    'workflow_executions',
    'workflows',
    'follow_ups',
    'leads',
    'pipeline_stages',
    'tags',
    'team_members',
  ];

  for (const table of tables) {
    await supabaseProd
      .from(table)
      .delete()
      .eq('organization_id', INTEGRATION_TEST_ORG_ID);
  }
}

/**
 * Removes the test organization entirely.
 */
export async function deleteTestOrg(): Promise<void> {
  if (!INTEGRATION_TEST_ORG_ID) return;

  await cleanupTestData();

  await supabaseProd
    .from('organizations')
    .delete()
    .eq('id', INTEGRATION_TEST_ORG_ID);

  INTEGRATION_TEST_ORG_ID = '';
}
