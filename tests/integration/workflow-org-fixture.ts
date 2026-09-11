import { supabase } from './setup';
import {
  createFixtureOrganization,
  deleteFixtureOrganization,
} from './organization-fixture';

/** A private org keeps global workflow trigger/claim tests out of shared seed data. */
export async function createWorkflowOrg(id: string): Promise<void> {
  await createFixtureOrganization(supabase, id, 'Workflow integration fixture');
}

export async function deleteWorkflowOrg(id: string): Promise<void> {
  await deleteFixtureOrganization(supabase, id);
}
