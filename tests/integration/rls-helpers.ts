/**
 * RLS test helpers — create authenticated Supabase clients for different users.
 * Each client is lazy-initialized and cached for the test suite lifetime.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TEST_PASSWORD } from './setup';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/**
 * 🔴 SESSÃO NUNCA PERSISTE, E CADA CLIENTE TEM A PRÓPRIA CHAVE DE ARMAZENAMENTO.
 *
 * O supabase-js guarda a sessão do usuário logado sob UMA chave e, por padrão,
 * TODO cliente criado no mesmo processo lê dessa mesma chave. O cliente
 * "service_role" então passava a mandar o JWT do último usuário que alguma
 * suíte tinha logado — e deixava de ser service_role: virava `authenticated`.
 *
 * Os sintomas ficavam a quilômetros da causa (SCRUM-424 / SCRUM-362):
 *
 *   • `leads`: INSERT do fixture morria em 42501, "new row violates row-level
 *     security policy" — RLS agindo sobre um cliente que deveria bypassá-la;
 *   • `password_reset_tokens`: "permission denied for table" nas cinco
 *     asserções da suíte de reset de senha. A tabela é deny-all por desenho —
 *     nenhum grant para anon/authenticated — então o erro é exatamente o que
 *     `authenticated` recebe. Produção CONCEDE tudo a service_role (medido em
 *     `pg_class.relacl`), e por isso a leitura do baseline nunca fechava o caso.
 *
 * O próprio SDK avisava, e o aviso passava por ruído: "Multiple GoTrueClient
 * instances detected in the same browser context ... under the same storage
 * key".
 *
 * `persistSession: false` mantém a sessão só em memória, no cliente que fez o
 * login; `storageKey` único é o cinto e suspensório.
 */
let storageKeySeq = 0;
function isolatedAuth(prefix: string) {
  storageKeySeq += 1;
  return {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `torque-test-${prefix}-${storageKeySeq}`,
    },
  };
}

/** Service role client — bypasses RLS. Use only for setup/teardown. */
export function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, isolatedAuth('service'));
}

/** Create a Supabase client authenticated as a specific user. */
export async function createAuthenticatedClient(
  email: string,
  password: string = TEST_PASSWORD,
): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, isolatedAuth('user'));
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to authenticate as ${email}: ${error.message}`);
  return client;
}

// Cached clients — initialized lazily per suite
const clientCache = new Map<string, SupabaseClient>();

export async function getClient(email: string): Promise<SupabaseClient> {
  if (!clientCache.has(email)) {
    clientCache.set(email, await createAuthenticatedClient(email));
  }
  return clientCache.get(email)!;
}

/** Clear all cached clients (call in afterAll). */
export async function clearClients(): Promise<void> {
  for (const [, client] of clientCache) {
    await client.auth.signOut();
  }
  clientCache.clear();
}

// Named client getters
export const getOrgAAdmin = () => getClient('admin@test.com');
export const getOrgAMember1 = () => getClient('member1@test.com');
export const getOrgAMember2 = () => getClient('member2@test.com');
export const getOrgBAdmin = () => getClient('adminb@test.com');
export const getOrgBMember = () => getClient('memberb@test.com');
export const getMaster = () => getClient('master@test.com');

// Assertion helpers

/** Assert that a SELECT returns exactly `expected` rows. */
export async function expectRowCount(
  client: SupabaseClient,
  table: string,
  expected: number,
  filter?: { column: string; value: string },
): Promise<void> {
  let query = client.from(table).select('id', { count: 'exact', head: true });
  if (filter) query = query.eq(filter.column, filter.value);
  const { count, error } = await query;
  if (error) throw new Error(`SELECT on ${table} failed: ${error.message} (code: ${error.code})`);
  if (count !== expected) {
    throw new Error(`Expected ${expected} rows in ${table}, got ${count}`);
  }
}

/** Assert that an INSERT is denied by RLS (returns error, not data). */
export async function expectInsertDenied(
  client: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from(table).insert(row);
  if (!error) {
    // Clean up the accidentally inserted row
    const svc = createServiceClient();
    if ('id' in row) await svc.from(table).delete().eq('id', row.id);
    throw new Error(`INSERT on ${table} should have been denied by RLS, but succeeded`);
  }
}

/** Assert that a DELETE is denied by RLS (deletes 0 rows or errors). */
export async function expectDeleteDenied(
  client: SupabaseClient,
  table: string,
  id: string,
): Promise<void> {
  const { error, count } = await client
    .from(table)
    .delete({ count: 'exact' })
    .eq('id', id);
  // RLS denial manifests as either an error or 0 rows affected
  if (!error && count && count > 0) {
    throw new Error(`DELETE on ${table} should have been denied by RLS, but deleted ${count} rows`);
  }
}
