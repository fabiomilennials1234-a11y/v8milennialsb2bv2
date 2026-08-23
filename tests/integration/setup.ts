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

/**
 * 🔴 `persistSession: false` NÃO É DETALHE — VER rls-helpers.ts.
 *
 * Sem isso, este cliente lê a sessão que qualquer outra suíte tiver gravado sob
 * a chave padrão do supabase-js e passa a mandar o JWT de um USUÁRIO em vez da
 * service key. Ele deixa de bypassar RLS, e os fixtures morrem em 42501 num
 * lugar que não tem nada a ver com o que está sendo testado.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'torque-test-setup-service',
  },
});

export const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_MASTER_ID = '00000000-0000-0000-0000-000000000010';
export const TEST_ADMIN_ID = '00000000-0000-0000-0000-000000000020';
export const TEST_SDR_ID = '00000000-0000-0000-0000-000000000030';

// Extended test IDs for RLS testing
export const TEST_ORG_B_ID = '00000000-0000-0000-0000-000000000002';
export const TEST_MEMBER_1_ID = '00000000-0000-0000-0000-000000000040';
export const TEST_MEMBER_2_ID = '00000000-0000-0000-0000-000000000050';
export const TEST_ADMIN_B_ID = '00000000-0000-0000-0000-000000000060';
export const TEST_MEMBER_B_ID = '00000000-0000-0000-0000-000000000070';

// Team member IDs
export const TEST_TM_MASTER_ID = '00000000-0000-0000-0000-000000000110';
export const TEST_TM_ADMIN_ID = '00000000-0000-0000-0000-000000000120';
export const TEST_TM_MEMBER_1_ID = '00000000-0000-0000-0000-000000000140';
export const TEST_TM_MEMBER_2_ID = '00000000-0000-0000-0000-000000000150';
export const TEST_TM_ADMIN_B_ID = '00000000-0000-0000-0000-000000000160';
export const TEST_TM_MEMBER_B_ID = '00000000-0000-0000-0000-000000000170';

// Lead IDs
export const TEST_LEAD_ALPHA_ID = '00000000-0000-0000-0000-000000001001';
export const TEST_LEAD_BETA_ID = '00000000-0000-0000-0000-000000001002';
export const TEST_LEAD_GAMMA_ID = '00000000-0000-0000-0000-000000001003';
export const TEST_LEAD_DELTA_ID = '00000000-0000-0000-0000-000000001004';
export const TEST_LEAD_ORGB_1_ID = '00000000-0000-0000-0000-000000002001';
export const TEST_LEAD_ORGB_2_ID = '00000000-0000-0000-0000-000000002002';

// Leads do cenário "Lead ≠ Negócio" (seed §12): L1 tem DOIS negócios abertos no
// "Funil Métricas", L2 tem um. Vivem na Org A de propósito — o E2E do Estúdio
// de Métricas entra com um usuário da Org A e precisa enxergá-los.
export const TEST_LEAD_DOIS_NEGOCIOS_ID = '00000000-0000-0000-0000-000000009001';
export const TEST_LEAD_UM_NEGOCIO_ID = '00000000-0000-0000-0000-000000009002';

/**
 * TODOS os leads que o seed cria na Org A.
 *
 * 🔴 QUEM ADICIONAR LEAD AO SEED ADICIONA AQUI. Cinco asserções de RLS pediam
 * `toHaveLength(4)` e passaram a receber 6 quando o cenário de métricas entrou
 * (SCRUM-362) — cinco vermelhos que se leem como falha de isolamento entre
 * suítes e não eram: o seed é que tinha crescido.
 *
 * A asserção passou a comparar o CONJUNTO, não o tamanho. Ela fica mais forte
 * (um lead trocado por outro deixa de passar despercebido) e o próximo fixture
 * quebra UM lugar, com o nome do que falta.
 */
export const TEST_ORG_A_LEAD_IDS = [
  TEST_LEAD_ALPHA_ID,
  TEST_LEAD_BETA_ID,
  TEST_LEAD_GAMMA_ID,
  TEST_LEAD_DELTA_ID,
  TEST_LEAD_DOIS_NEGOCIOS_ID,
  TEST_LEAD_UM_NEGOCIO_ID,
] as const;

// Common password for all test users
export const TEST_PASSWORD = 'Test123!@#';

/**
 * Devolve o id do funil de sistema da org — o QUE JÁ EXISTE, nunca um segundo.
 *
 * 🔴 TRÊS FIXTURES CRIAVAM UM FUNIL 'whatsapp' PARALELO E FALHAVAM EM SILÊNCIO
 * (SCRUM-362). `pipelines` tem `UNIQUE (organization_id, slug)`, e o upsert
 * delas vinha com `onConflict: 'id'` — id novo, mesmo par (org, slug). O
 * conflito caía no índice ERRADO, o Postgres devolvia 23505, ninguém checava o
 * erro, e o funil não nascia. As entries seguintes morriam na FK, também em
 * silêncio, e a RPC respondia com o que sobrava: a linha do seed.
 *
 * O sintoma era `expected Set{1 item} to deeply equal Set{2 items}` em
 * get_stage_lead_ids e get_filtered_lead_ids — que se lê como bug na RPC, e não
 * era: a RPC estava certa, o fixture é que nunca existiu.
 *
 * Em produção há UM funil de sistema por slug por org (nasce no
 * provisionamento). Duplicar isso no teste não reproduz nada real.
 */
/**
 * Devolve o funil de sistema ao estado do seed: uma entry em `novo` para o
 * Lead Alpha (Org A) e uma para o OrgB-1 (Org B).
 *
 * As suítes dos resolvers de público limpam o funil inteiro para montar o
 * cenário delas. Sem esta restauração, quem rodar depois encontra o funil vazio
 * — e `rls-org-isolation` afirma "Org A vê exatamente 1 pipe_whatsapp", que é
 * VIEW sobre essas entries. Com `--no-file-parallelism` a ordem é estável, mas
 * "estável" não é "restaurada".
 */
export async function restoreSeedWhatsappEntries(): Promise<void> {
  const [pipeA, pipeB] = await Promise.all([
    getSystemPipelineId(TEST_ORG_ID, 'whatsapp'),
    getSystemPipelineId(TEST_ORG_B_ID, 'whatsapp'),
  ]);
  await supabase.from('pipeline_entries').delete().in('pipeline_id', [pipeA, pipeB]);
  await supabase.from('pipeline_entries').insert([
    {
      organization_id: TEST_ORG_ID,
      pipeline_id: pipeA,
      lead_id: TEST_LEAD_ALPHA_ID,
      stage_key: 'novo',
    },
    {
      organization_id: TEST_ORG_B_ID,
      pipeline_id: pipeB,
      lead_id: TEST_LEAD_ORGB_1_ID,
      stage_key: 'novo',
    },
  ]);
}

export async function getSystemPipelineId(
  organizationId: string,
  slug: 'whatsapp' | 'confirmacao' | 'propostas',
): Promise<string> {
  const { data, error } = await supabase
    .from('pipelines')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`getSystemPipelineId(${slug}): ${error.message}`);
  if (data?.id) return data.id as string;

  const { data: created, error: insErr } = await supabase
    .from('pipelines')
    .insert({ organization_id: organizationId, name: slug, slug, type: 'system' })
    .select('id')
    .single();
  if (insErr) throw new Error(`getSystemPipelineId(${slug}) insert: ${insErr.message}`);
  return created!.id as string;
}
