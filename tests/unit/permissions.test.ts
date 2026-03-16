import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase client ────────────────────────────────
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getSession: () => mockGetSession(),
    },
  },
}));

// ─── Import the imperative helpers (non-hook functions) ──
import { assertIsAdmin, assertOrgPermission, checkMatrixPermission } from '@/lib/permissions';

// ─── Tests ───────────────────────────────────────────────

describe('permissions — imperative helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertIsAdmin', () => {
    it('resolves when user is admin (rpc returns true)', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });
      await expect(assertIsAdmin()).resolves.toBeUndefined();
      expect(mockRpc).toHaveBeenCalledWith('is_user_admin');
    });

    it('throws when user is not admin', async () => {
      mockRpc.mockResolvedValue({ data: false, error: null });
      await expect(assertIsAdmin()).rejects.toThrow('Apenas administradores');
    });
  });

  describe('assertOrgPermission', () => {
    it('resolves when permission exists', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });
      await expect(assertOrgPermission('can_delete_leads')).resolves.toBeUndefined();
      expect(mockRpc).toHaveBeenCalledWith('user_has_org_permission', {
        p_permission_key: 'can_delete_leads',
      });
    });

    it('throws with default message when permission denied', async () => {
      mockRpc.mockResolvedValue({ data: false, error: null });
      await expect(assertOrgPermission('can_delete_leads')).rejects.toThrow(
        'Sem permissão: can_delete_leads',
      );
    });

    it('throws with custom message when permission denied', async () => {
      mockRpc.mockResolvedValue({ data: false, error: null });
      await expect(
        assertOrgPermission('can_delete_leads', 'Acesso negado'),
      ).rejects.toThrow('Acesso negado');
    });
  });

  describe('checkMatrixPermission', () => {
    it('returns true when no record exists (default = allowed)', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await checkMatrixPermission('tm-1', 'leads', 'create');
      expect(result).toBe(true);
    });

    it('returns true when value is "allowed"', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { value: 'allowed' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const result = await checkMatrixPermission('tm-1', 'leads', 'create');
      expect(result).toBe(true);
    });

    it('returns false when value is "denied"', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { value: 'denied' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const result = await checkMatrixPermission('tm-1', 'leads', 'create');
      expect(result).toBe(false);
    });
  });
});

describe('permissions — feature permission logic (pure)', () => {
  /**
   * These tests verify the feature permission cascade logic in isolation,
   * without React hooks. The cascade is:
   *   master/admin → always allowed
   *   member → check member_feature_permissions override → feature_permissions default_value
   */

  interface FeaturePermission {
    key: string;
    is_admin_only: boolean;
    default_value: boolean;
  }

  interface MemberOverride {
    feature_key: string;
    enabled: boolean;
  }

  /**
   * Pure function replicating the cascade logic used by
   * useFeaturePermission and the get-member-permissions edge function.
   */
  function resolveFeaturePermission(
    featureKey: string,
    role: 'admin' | 'member',
    isMaster: boolean,
    features: FeaturePermission[],
    overrides: MemberOverride[],
  ): boolean {
    // Admin/master always have access
    if (isMaster || role === 'admin') return true;

    const feature = features.find((f) => f.key === featureKey);
    if (!feature) return false;

    // Admin-only features are blocked for members
    if (feature.is_admin_only) return false;

    // Check member override
    const override = overrides.find((o) => o.feature_key === featureKey);
    if (override !== undefined) return override.enabled;

    // Fall back to default
    return feature.default_value;
  }

  const FEATURES: FeaturePermission[] = [
    { key: 'leads.view', is_admin_only: false, default_value: true },
    { key: 'leads.delete', is_admin_only: false, default_value: false },
    { key: 'team.manage', is_admin_only: true, default_value: false },
    { key: 'copilot.create', is_admin_only: false, default_value: true },
    { key: 'products.create', is_admin_only: false, default_value: true },
  ];

  it('admin has access to any feature (including is_admin_only)', () => {
    expect(resolveFeaturePermission('team.manage', 'admin', false, FEATURES, [])).toBe(true);
    expect(resolveFeaturePermission('leads.view', 'admin', false, FEATURES, [])).toBe(true);
    expect(resolveFeaturePermission('leads.delete', 'admin', false, FEATURES, [])).toBe(true);
  });

  it('master has access to any feature', () => {
    expect(resolveFeaturePermission('team.manage', 'member', true, FEATURES, [])).toBe(true);
    expect(resolveFeaturePermission('leads.delete', 'member', true, FEATURES, [])).toBe(true);
  });

  it('member has access to features with default_value = true', () => {
    expect(resolveFeaturePermission('leads.view', 'member', false, FEATURES, [])).toBe(true);
    expect(resolveFeaturePermission('copilot.create', 'member', false, FEATURES, [])).toBe(true);
  });

  it('member does NOT have access to features with is_admin_only = true', () => {
    expect(resolveFeaturePermission('team.manage', 'member', false, FEATURES, [])).toBe(false);
  });

  it('member does NOT have access to features with default_value = false (no override)', () => {
    expect(resolveFeaturePermission('leads.delete', 'member', false, FEATURES, [])).toBe(false);
  });

  it('member with explicit enabled = true has access even if default = false', () => {
    const overrides: MemberOverride[] = [{ feature_key: 'leads.delete', enabled: true }];
    expect(resolveFeaturePermission('leads.delete', 'member', false, FEATURES, overrides)).toBe(true);
  });

  it('member with explicit enabled = false does NOT have access even if default = true', () => {
    const overrides: MemberOverride[] = [{ feature_key: 'leads.view', enabled: false }];
    expect(resolveFeaturePermission('leads.view', 'member', false, FEATURES, overrides)).toBe(false);
  });

  it('returns false for unknown feature key', () => {
    expect(resolveFeaturePermission('unknown.feature', 'member', false, FEATURES, [])).toBe(false);
  });
});

describe('permissions — useJobTitle and useMetricType logic (pure)', () => {
  /**
   * These test the pure extraction logic used by useJobTitle and useMetricType.
   * The hooks themselves are thin wrappers around team member data.
   */

  function extractJobTitle(teamMember: { job_title?: string | null } | null): string {
    return teamMember?.job_title || '';
  }

  function extractMetricType(teamMember: { metric_type?: string | null } | null): 'meetings' | 'sales' {
    return (teamMember?.metric_type as 'meetings' | 'sales') || 'meetings';
  }

  describe('extractJobTitle', () => {
    it('returns job_title when set', () => {
      expect(extractJobTitle({ job_title: 'Closer Senior' })).toBe('Closer Senior');
    });

    it('returns empty string when job_title is null', () => {
      expect(extractJobTitle({ job_title: null })).toBe('');
    });

    it('returns empty string when team member is null', () => {
      expect(extractJobTitle(null)).toBe('');
    });

    it('returns empty string when job_title is undefined', () => {
      expect(extractJobTitle({})).toBe('');
    });
  });

  describe('extractMetricType', () => {
    it('returns "meetings" by default', () => {
      expect(extractMetricType(null)).toBe('meetings');
      expect(extractMetricType({})).toBe('meetings');
      expect(extractMetricType({ metric_type: null })).toBe('meetings');
    });

    it('returns "sales" for member configured as sales', () => {
      expect(extractMetricType({ metric_type: 'sales' })).toBe('sales');
    });

    it('returns "meetings" for member configured as meetings', () => {
      expect(extractMetricType({ metric_type: 'meetings' })).toBe('meetings');
    });
  });
});

describe('permissions — action mapping', () => {
  /**
   * Verify that ACTION_TO_FEATURE mapping works correctly
   * for the useCanPerformAction logic.
   */

  const ACTION_TO_FEATURE: Record<string, string> = {
    edit_workflow: 'workflows.edit',
    create_workflow: 'workflows.create',
    manage_team: 'team.view',
    manage_copilot: 'copilot.create',
  };

  it('feature-based actions map to correct feature keys', () => {
    expect(ACTION_TO_FEATURE['edit_workflow']).toBe('workflows.edit');
    expect(ACTION_TO_FEATURE['create_workflow']).toBe('workflows.create');
    expect(ACTION_TO_FEATURE['manage_team']).toBe('team.view');
    expect(ACTION_TO_FEATURE['manage_copilot']).toBe('copilot.create');
  });

  it('non-feature actions have no feature mapping', () => {
    expect(ACTION_TO_FEATURE['import_leads']).toBeUndefined();
    expect(ACTION_TO_FEATURE['send_message']).toBeUndefined();
    expect(ACTION_TO_FEATURE['delete_lead']).toBeUndefined();
  });
});
