/**
 * Setup das suítes que falam com um Supabase REMOTO.
 *
 * Antes chamava-se `setup-prod.ts` e trazia o ref de PRODUÇÃO como default —
 * com `ensureTestOrg()` criando organização lá. Estava dentro do glob de
 * `npm run test:integration`, que o CI roda a cada push; o que impedia o
 * estrago era só a ausência de uma variável de ambiente.
 *
 * Agora o alvo vem do `guard`, que RECUSA produção. Ver o cabeçalho de
 * `tests/remote/guard.ts` para a decisão e o porquê.
 *
 * A org de teste continua isolada por `organization_id` — mas isolamento em
 * produção nunca foi a garantia certa. A garantia certa é não estar lá.
 */

import { createClient } from '@supabase/supabase-js';
import { alvoRemoto, chaveRemota } from './guard';

/**
 * Cliente da BRANCH EFÊMERA. O nome antigo (`supabaseProd`) fica como alias
 * para não reescrever as suítes num commit que é sobre segurança, não sobre
 * renomear — mas ele já não aponta para produção, e o guard garante isso.
 */
export const supabaseRemoto = createClient(alvoRemoto(), chaveRemota());

/** @deprecated Use `supabaseRemoto`. Mantido para não misturar assuntos no diff. */
export const supabaseProd = supabaseRemoto;

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
    // SCRUM-621: custom_pipe_entries virou view; a fonte única é
    // pipeline_entries (cobre custom e o que as pipe_* acima não pegarem).
    'pipeline_entries',
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
