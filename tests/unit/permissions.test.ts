import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase client ────────────────────────────────
const mockRpc = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// ─── Import ─────────────────────────────────────────────
import { assertPermission } from '@/modules/identity/permissions/lib/permissions';
import { ACTION_TO_FEATURE } from '@/shared/permission-actions';

// ─── Tests ───────────────────────────────────────────────

describe('assertPermission (imperative)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves when is_user_admin returns true', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    await expect(assertPermission('delete_lead')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('is_user_admin');
  });

  it('resolves for member with feature permission', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    await expect(assertPermission('delete_lead')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('user_has_org_permission', {
      p_permission_key: 'leads.delete',
    });
  });

  it('throws when member lacks permission', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    await expect(assertPermission('delete_lead')).rejects.toThrow(
      'Sem permissão: leads.delete',
    );
  });
});

describe('permissions — feature permission logic (pure)', () => {
  interface FeaturePermission {
    key: string;
    is_admin_only: boolean;
    default_value: boolean;
  }

  interface MemberOverride {
    feature_key: string;
    enabled: boolean;
  }

  function resolveFeaturePermission(
    featureKey: string,
    role: 'admin' | 'member',
    isMaster: boolean,
    features: FeaturePermission[],
    overrides: MemberOverride[],
  ): boolean {
    if (isMaster || role === 'admin') return true;

    const feature = features.find((f) => f.key === featureKey);
    if (!feature) return false;

    if (feature.is_admin_only) return false;

    const override = overrides.find((o) => o.feature_key === featureKey);
    if (override !== undefined) return override.enabled;

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

describe('ACTION_TO_FEATURE — canonical map', () => {
  it('all 17 actions are mapped', () => {
    expect(Object.keys(ACTION_TO_FEATURE)).toHaveLength(17);
  });

  it('key actions map to correct feature keys', () => {
    expect(ACTION_TO_FEATURE.edit_workflow).toBe('workflows.edit');
    expect(ACTION_TO_FEATURE.create_workflow).toBe('workflows.create');
    expect(ACTION_TO_FEATURE.manage_team).toBe('team.view');
    expect(ACTION_TO_FEATURE.manage_copilot).toBe('copilot.create');
    expect(ACTION_TO_FEATURE.delete_lead).toBe('leads.delete');
    expect(ACTION_TO_FEATURE.send_message).toBe('whatsapp.send_messages');
    expect(ACTION_TO_FEATURE.import_leads).toBe('leads.import');
  });
});
