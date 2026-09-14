// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { createMockSupabase } from '../helpers/supabase-mock';
vi.mock('../../supabase/functions/_shared/ai-queue.ts', () => ({ enqueueAiAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../supabase/functions/_shared/google-calendar-utils.ts', () => ({ getValidAccessToken:vi.fn().mockResolvedValue(null),logCalendarOp:vi.fn() }));
import { executeScheduleMeeting } from '../../supabase/functions/_shared/actions/schedule-meeting';

it('Copilot books a real appointment without creating a legacy funnel entry',async () => {
  const mock=createMockSupabase();
  const result=await executeScheduleMeeting(mock.sb,{lead_id:'lead',preferred_date:'2026-09-20',preferred_time:'15:00'},'org',null);
  expect(result.success).toBe(true);
  expect(mock.getInserted('meetings')[0]).toMatchObject({event_type:'meeting',organization_id:'org',lead_id:'lead',start_at:'2026-09-20T18:00:00.000Z'});
  expect(mock.getInserted('pipeline_entries')).toEqual([]);
  expect(mock.getInserted('follow_ups')).toEqual([]);
  expect(result.data?.meeting_id).toBe(mock.getInserted('meetings')[0].id);
});
it('retry returns the same appointment instead of creating another',async () => {
  const mock=createMockSupabase();
  mock.mockTable('meetings',[{id:'already-booked',organization_id:'org',external_ref:'automation:meeting:lead:2026-09-20T18:00:00.000Z'}]);
  const result=await executeScheduleMeeting(mock.sb,{lead_id:'lead',preferred_date:'2026-09-20',preferred_time:'15:00'},'org',null);
  expect(result.data?.meeting_id).toBe('already-booked');
  expect(mock.getInserted('meetings')).toEqual([]);
});
