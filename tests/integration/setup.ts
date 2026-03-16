/**
 * Integration test setup — connects to local Supabase instance.
 *
 * Prerequisites:
 *   1. `supabase start` must be running
 *   2. Local Supabase at http://localhost:54321
 *
 * Uses the service_role key for full access during tests.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_MASTER_ID = '00000000-0000-0000-0000-000000000010';
export const TEST_ADMIN_ID = '00000000-0000-0000-0000-000000000020';
export const TEST_SDR_ID = '00000000-0000-0000-0000-000000000030';
