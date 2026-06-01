import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase client ────────────────────────────────
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockRange = vi.fn();
const mockDelete = vi.fn();
const mockIn = vi.fn();
const mockRpc = vi.fn();

function createChain(resolvedData: unknown[] = []) {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    order: mockOrder,
    range: mockRange,
    delete: mockDelete,
    in: mockIn,
  };
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  mockDelete.mockReturnValue(chain);
  mockIn.mockReturnValue(Promise.resolve({ data: [], error: null }));
  mockRange.mockResolvedValue({ data: resolvedData, error: null });
  return chain;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => createChain(),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'test-user' } } }, error: null }),
    },
  },
}));

vi.mock('@/modules/identity/hooks/useOrganization', () => ({
  useOrganization: () => ({ organizationId: 'org-123' }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: ({ mutationFn }: { mutationFn: (...args: any[]) => any }) => ({
    mutateAsync: mutationFn,
    isPending: false,
  }),
}));

vi.mock('@/modules/identity/permissions/lib/permissions', () => ({
  useCanPerformActionAsync: () => vi.fn(),
  assertPermission: vi.fn().mockResolvedValue(undefined),
  assertIsAdmin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/identity/master/hooks/useMasterAuth', () => ({
  useMasterAuth: () => ({ isMaster: false, isLoading: false }),
}));

vi.mock('@/modules/identity/permissions/hooks/useUserRole', () => ({
  useIsAdmin: () => ({ isAdmin: false, isLoading: false }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false, isError: false }),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
  useCanManageCopilot: () => ({ canManage: true, canCreate: true, canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
  useCanManageWhatsApp: () => ({ canManage: true, isLoading: false }),
  useUserRole: () => ({ data: { role: "admin" }, isLoading: false }),
  useJobTitle: () => ({ jobTitle: "", isLoading: false }),
  useMetricType: () => ({ metricType: "sales", isLoading: false }),
  useHasRole: () => ({ hasRole: true, isLoading: false }),
}));

const mockIdentity = {
  userId: "user-1",
  organizationId: "org-123",
  teamMemberId: "tm-1",
  effectiveRole: "admin" as const,
  isMaster: false,
  isAdmin: true,
  features: {} as Record<string, boolean>,
  isLoading: false,
  isReady: true,
};
vi.mock('@/modules/identity/auth/hooks/useIdentity', () => ({
  useIdentity: () => mockIdentity,
}));

vi.mock('@/modules/identity/permissions/hooks/useCanDo', () => ({
  useCanDo: () => ({ allowed: true, reason: "admin", isLoading: false }),
}));

// ─── Import after mocks ─────────────────────────────────
import { useDeleteAllLeadsInPipe } from '@/modules/leads';

// ─── Tests ───────────────────────────────────────────────

describe('useDeleteAllLeadsInPipe — stage filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdentity.isAdmin = true;
    mockIdentity.effectiveRole = "admin" as any;
    // Permission: allow by default
    mockRpc.mockResolvedValue({ data: true, error: null });
  });

  it('requires stageId parameter — throws if empty string', async () => {
    const hook = useDeleteAllLeadsInPipe('whatsapp');
    await expect(hook.mutateAsync({ stageId: '' })).rejects.toThrow('No stage specified');
  });

  it('calls .eq("status", stageId) when stageId is provided', async () => {
    // Return some lead_ids so we can check the flow
    const leadIds = [{ lead_id: 'lead-1' }, { lead_id: 'lead-2' }];
    createChain(leadIds);

    const hook = useDeleteAllLeadsInPipe('whatsapp');
    await hook.mutateAsync({ stageId: 'novo_lead' });

    // Verify that .eq was called with "status" and the stageId
    const eqCalls = mockEq.mock.calls;
    const statusFilter = eqCalls.find(
      ([col, val]: [string, string]) => col === 'status' && val === 'novo_lead'
    );
    expect(statusFilter).toBeDefined();
  });

  it('filters by organization_id for security', async () => {
    createChain([]);

    const hook = useDeleteAllLeadsInPipe('confirmacao');
    await hook.mutateAsync({ stageId: 'reuniao_marcada' });

    const eqCalls = mockEq.mock.calls;
    const orgFilter = eqCalls.find(
      ([col, val]: [string, string]) => col === 'organization_id' && val === 'org-123'
    );
    expect(orgFilter).toBeDefined();
  });

  it('returns { deleted: 0 } when no leads match the stage', async () => {
    createChain([]);

    const hook = useDeleteAllLeadsInPipe('propostas');
    const result = await hook.mutateAsync({ stageId: 'proposta_enviada' });
    expect(result).toEqual({ deleted: 0 });
  });

  it('throws if user lacks can_delete_leads permission', async () => {
    mockIdentity.isAdmin = false;
    mockIdentity.effectiveRole = "member" as any;
    mockRpc.mockResolvedValue({ data: false, error: null });

    const hook = useDeleteAllLeadsInPipe('whatsapp');
    await expect(hook.mutateAsync({ stageId: 'novo_lead' })).rejects.toThrow('permissão');
  });
});
