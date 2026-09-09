import type { SupabaseClient } from '@supabase/supabase-js';

export async function createFixtureOrganization(
  client: SupabaseClient,
  id: string,
  name = 'Integration fixture',
): Promise<void> {
  const { error } = await client.from('organizations').insert({
    id,
    name,
    slug: `integration-fixture-${id}`,
  });
  if (error) throw error;
}

export async function deleteFixtureOrganization(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  // Stage deletion enqueues reclassification work. Keep the organization alive
  // until those triggers finish, then remove their queue rows before the org.
  const { error } = await client
    .from('organizations')
    .update({ default_pipeline_id: null })
    .eq('id', id);
  if (error) throw error;

  for (const table of ['pipeline_stages', 'followup_reclassify_queue', 'pipelines']) {
    const result = await client.from(table).delete().eq('organization_id', id);
    if (result.error) throw result.error;
  }

  const result = await client.from('organizations').delete().eq('id', id);
  if (result.error) throw result.error;
}
