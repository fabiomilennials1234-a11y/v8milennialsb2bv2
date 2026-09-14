import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export class MeetingReferenceError extends Error {}

/** Resolve IDs before the service-role insert: FKs alone do not isolate tenants. */
export async function resolveMeetingReferences(
  db: SupabaseClient,
  organizationId: string,
  input: { leadId: string | null; assignedTo: string | null; keyCreator: string | null; participants: string[] },
) {
  if (input.leadId) {
    const { data, error } = await db.from('leads').select('id')
      .eq('id', input.leadId).eq('organization_id', organizationId).maybeSingle();
    if (error) throw error;
    if (!data) throw new MeetingReferenceError('lead_id not found in this organization');
  }
  let query = db.from('team_members').select('id,user_id').eq('organization_id', organizationId);
  if (input.assignedTo) query = query.eq('id', input.assignedTo);
  else if (input.keyCreator) query = query.eq('user_id', input.keyCreator);
  else throw new MeetingReferenceError('Provide assigned_to or an API key created by an organization member');
  const { data: member, error } = await query.maybeSingle();
  if (error) throw error;
  if (!member) throw new MeetingReferenceError('assigned_to team member not found in this organization');
  const participants = [...new Set(input.participants)];
  if (participants.length) {
    const { data, error: participantsError } = await db.from('team_members').select('id')
      .eq('organization_id', organizationId).in('id', participants);
    if (participantsError) throw participantsError;
    if (data?.length !== participants.length) throw new MeetingReferenceError('participants must belong to this organization');
  }
  // meetings.created_by references auth.users; participants reference team_members.
  return { assignedTo: member.id as string, createdBy: member.user_id as string | null, participants };
}
