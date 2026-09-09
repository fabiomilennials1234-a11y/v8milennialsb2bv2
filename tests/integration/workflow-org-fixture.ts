import { supabase } from './setup';

/** A private org keeps global workflow trigger/claim tests out of shared seed data. */
export async function createWorkflowOrg(id: string): Promise<void> {
  const { error } = await supabase.from('organizations').insert({
    id, name: 'Workflow integration fixture', slug: `workflow-fixture-${id}`,
  });
  if (error) throw error;
}

export async function deleteWorkflowOrg(id: string): Promise<void> {
  // Same explicit order as migration 20270918000000's rehearsal. Deleting the
  // org first makes stage triggers enqueue an already-deleted organization.
  const { error } = await supabase.from('organizations')
    .update({ default_pipeline_id: null }).eq('id', id);
  if (error) throw error;
  for (const table of ['pipeline_stages', 'followup_reclassify_queue', 'pipelines']) {
    const result = await supabase.from(table).delete().eq('organization_id', id);
    if (result.error) throw result.error;
  }
  const result = await supabase.from('organizations').delete().eq('id', id);
  if (result.error) throw result.error;
}
