import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase ───────────────────────────────────────
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockGetUser = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: () => mockGetUser(),
    },
    from: vi.fn().mockReturnValue({
      insert: (...args: unknown[]) => mockInsert(...args),
    }),
  },
}));

import { track } from '@/lib/analytics';

describe('analytics — track()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ data: null, error: null });
  });

  it('calls supabase.from("usage_events").insert with correct fields', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    track({
      event: 'lead_created',
      organizationId: 'org-1',
      entityType: 'lead',
      entityId: 'lead-1',
      metadata: { source: 'manual' },
    });

    // track is fire-and-forget — wait for async to settle
    await vi.waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    expect(mockInsert).toHaveBeenCalledWith({
      organization_id: 'org-1',
      user_id: 'user-1',
      event_type: 'lead_created',
      entity_type: 'lead',
      entity_id: 'lead-1',
      metadata: { source: 'manual' },
    });
  });

  it('does not throw if Supabase fails', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });
    mockInsert.mockRejectedValue(new Error('DB down'));

    expect(() => {
      track({
        event: 'lead_created',
        organizationId: 'org-1',
      });
    }).not.toThrow();

    // Give async time to settle without throwing
    await new Promise((r) => setTimeout(r, 50));
  });

  it('does not throw if user is not logged in', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
    });

    expect(() => {
      track({
        event: 'lead_created',
        organizationId: 'org-1',
      });
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 50));
    // insert should NOT have been called since user is null
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('does not call insert if organizationId is empty', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    track({
      event: 'lead_created',
      organizationId: '',
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
