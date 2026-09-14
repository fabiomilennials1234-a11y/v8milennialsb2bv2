import { describe, it, expect } from 'vitest';
import { createMockSupabase } from '../helpers/supabase-mock';
import { resolveMeetingReferences } from '../../supabase/functions/meeting-webhook/references';

function fixture() {
  const mock = createMockSupabase();
  mock.mockTable('leads', [{ id: 'lead', organization_id: 'org' }, { id: 'foreign', organization_id: 'other' }]);
  mock.mockTable('team_members', [
    { id: 'member', user_id: 'auth-user', organization_id: 'org' },
    { id: 'foreign-member', user_id: 'other-user', organization_id: 'other' },
  ]);
  return mock;
}
const input = { leadId: 'lead', assignedTo: 'member', keyCreator: null, participants: ['member','member'] };
describe('meeting-webhook tenant references', () => {
  it('stores auth.users ID as creator and team_members ID as participant', async () => {
    const { sb } = fixture();
    expect(await resolveMeetingReferences(sb,'org',input)).toEqual({assignedTo:'member',createdBy:'auth-user',participants:['member']});
  });
  it('resolves the API creator within this organization', async () => {
    const { sb } = fixture();
    expect((await resolveMeetingReferences(sb,'org',{...input,assignedTo:null,keyCreator:'auth-user'})).createdBy).toBe('auth-user');
  });
  it.each([
    { leadId: 'foreign' }, { assignedTo: 'foreign-member' }, { participants: ['foreign-member'] },
  ])('rejects foreign references before writing: %j', async (foreign) => {
    const { sb, getInserted } = fixture();
    await expect(resolveMeetingReferences(sb,'org',{...input,...foreign})).rejects.toThrow(/organization/);
    expect(getInserted('meetings')).toEqual([]);
  });
});
