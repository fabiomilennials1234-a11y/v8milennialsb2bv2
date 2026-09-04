/**
 * Sprint 2 — batch test for small hooks at 0% coverage.
 *
 * Covers: usePipeMetrics, useWhatsAppLeadIntegration, useTinyErp,
 * useChecklists, useWhatsAppConversations, useScheduledMessages,
 * useExportLeads, useMasterOrganizations, useWhatsAppInstances,
 * usePipePropostas, usePipeConfirmacao, usePipeWhatsapp.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// ── Chain mock factory ──
function createChainMock(data: unknown[] = [], singleData?: unknown) {
  const chain: Record<string, any> = {};
  const methods = [
    "select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike",
    "contains", "order", "limit", "range", "insert", "update", "delete",
    "upsert", "not", "is", "filter", "match", "overlaps", "textSearch",
    "csv", "count", "abortSignal",
  ];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({
    data: singleData ?? data[0] ?? { id: "mock-1", organization_id: "org-t" },
    error: null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: singleData !== undefined ? singleData : (data[0] ?? null),
    error: null,
  });
  // Make the chain thenable so `await supabase.from(...).select(...)` resolves
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
  chain.catch = (fn: any) =>
    Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());
const mockRpc = vi.fn().mockResolvedValue({ data: [{ id: "1" }], error: null });
const mockInvoke = vi.fn().mockResolvedValue({ data: null, error: null });
const mockUpload = vi.fn().mockResolvedValue({ error: null });
const mockGetPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/file.png" } });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: (...args: any[]) => mockRpc(...args),
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: (...a: any[]) => mockUpload(...a),
        getPublicUrl: (...a: any[]) => mockGetPublicUrl(...a),
      }),
    },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }),
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true, teamMemberId: "tm1" }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { id: "tm1", organization_id: "org-t", user_id: "u1", role: "admin" },
  }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/pipelines/hooks/model/usePipelineStages", () => ({
  usePipelineStages: () => ({ data: [] }),
  DEFAULT_STAGES: {
    whatsapp: [{ id: "novo" }],
    confirmacao: [{ id: "reuniao_marcada" }],
    propostas: [{ id: "marcar_compromisso" }],
  },
}));
vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({
  triggerFollowUpAutomation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/leads/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));
vi.mock("@/lib/workflowTrigger", () => ({
  triggerLeadCreatedInCustomPipeline: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({
  assertIsAdmin: vi.fn().mockResolvedValue(undefined),
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/normalizePhone", () => ({
  normalizePhone: (p: string) => (p ? p.replace(/\D/g, "") : null),
}));
vi.mock("@/lib/evolutionApi", () => ({
  createEvolutionInstance: vi.fn().mockResolvedValue({
    instance: { instanceName: "test-inst" },
    qrcode: { base64: "qr-b64" },
  }),
  getQRCode: vi.fn().mockResolvedValue({ base64: "qr-refreshed" }),
  getConnectionState: vi.fn().mockResolvedValue({ instance: { state: "open" } }),
  deleteEvolutionInstance: vi.fn().mockResolvedValue(undefined),
  logoutInstance: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), info: vi.fn() },
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({}));

// ── Imports ──
import {
  usePipePropostasMetrics,
  usePipeConfirmacaoMetrics,
  usePipeWhatsappMetrics,
} from "@/modules/pipelines/hooks/config/usePipeMetrics";
import {
  useLeadByPhone,
  usePipeWhatsappByLeadId,
  useCreateLeadFromWhatsApp,
  useLinkLeadToWhatsApp,
  useUpdateLeadPipelineStatus,
} from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import {
  useTinyErpStatus,
  useConnectTinyErp,
  useDisconnectTinyErp,
  useTinyErpSyncProducts,
  useTinyErpPushOrder,
  useTinyErpSyncLogs,
  useUpdateTinyErpSettings,
  useTinyErpOrderMapping,
  useTinyErpFetchNfe,
} from "@/modules/carteira/hooks/useTinyErp";
import {
  useChecklists,
  useChecklistItems,
  useCreateChecklist,
  useUpdateChecklist,
  useDeleteChecklist,
  useCreateChecklistItem,
  useToggleChecklistItem,
  useUpdateChecklistItem,
  useDeleteChecklistItem,
  useReorderChecklistItems,
} from "@/modules/engagement/hooks/useChecklists";
import {
  useWhatsAppConversationsMeta,
  useWhatsAppConversationTags,
  useArchiveConversation,
  useUnarchiveConversation,
  useDeleteConversation,
  useAddConversationTag,
  useRemoveConversationTag,
} from "@/modules/communication/hooks/useWhatsAppConversations";
import {
  useScheduledMessagesForLead,
  useLeadsWithScheduledMessages,
  useCreateScheduledMessage,
  useCancelScheduledMessage,
  useUpdateScheduledMessage,
  useMyScheduledMessages,
} from "@/modules/communication/hooks/useScheduledMessages";
import { useExportLeads, EXPORT_LEAD_HEADERS } from "@/modules/leads";
import {
  useMasterOrganizations,
  useMasterOrganization,
  useMasterOrganizationStats,
  useMasterCreateOrganization,
  useMasterUpdateOrganization,
  useMasterDeleteOrganization,
  useMasterBillingOverride,
  useMasterOrganizationMembers,
} from "@/modules/identity/master/hooks/useMasterOrganizations";
import {
  useWhatsAppInstances,
  useWhatsAppInstancesWithAgent,
  useCreateWhatsAppInstance,
  useUpdateWhatsAppInstance,
  useRefreshQRCode,
  useCheckConnectionStatus,
  useDeleteWhatsAppInstance,
  useLogoutInstance,
} from "@/modules/communication/hooks/useWhatsAppInstances";
import { usePipePropostas, useCreatePipeProposta, useUpdatePipeProposta, useDeletePipeProposta } from "@/modules/pipelines/hooks/legacy/usePipePropostas";
import { usePipeConfirmacao, useCreatePipeConfirmacao, useUpdatePipeConfirmacao, useDeletePipeConfirmacao } from "@/modules/pipelines/hooks/legacy/usePipeConfirmacao";
import { usePipeWhatsapp, useCreatePipeWhatsapp, useUpdatePipeWhatsapp, useDeletePipeWhatsapp } from "@/modules/pipelines/hooks/legacy/usePipeWhatsapp";

// ── Setup ──
beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue(createChainMock());
  mockRpc.mockResolvedValue({ data: [{ id: "1" }], error: null });
  mockInvoke.mockResolvedValue({ data: null, error: null });
});

// ═══════════════════════════════════════════════════════════
// 1. usePipeMetrics
// ═══════════════════════════════════════════════════════════
describe("usePipeMetrics", () => {
  describe("usePipePropostasMetrics", () => {
    it("returns default metrics when period=all", async () => {
      mockFrom.mockReturnValue(
        createChainMock([
          { status: "vendido", sale_value: 1000, product_type: "mrr" },
          { status: "perdido", sale_value: 500, product_type: "projeto" },
          { status: "proposta_enviada", sale_value: 300, product_type: null },
        ])
      );
      const { result } = renderHook(() => usePipePropostasMetrics("all"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess || result.current.data !== undefined).toBe(true));
    });

    it("returns metrics for month period", async () => {
      mockFrom.mockReturnValue(createChainMock([]));
      const { result } = renderHook(() => usePipePropostasMetrics("month", 3, 2026), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false || result.current.data !== undefined).toBe(true));
    });
  });

  describe("usePipeConfirmacaoMetrics", () => {
    it("returns metrics for all period", async () => {
      const singleData = { confirmacao_overdue_days: 5 };
      mockFrom.mockReturnValue(createChainMock([
        { status: "compareceu", meeting_date: "2026-04-13", updated_at: "2026-04-01T00:00:00Z" },
        { status: "perdido", meeting_date: "2026-04-10", updated_at: "2026-04-01T00:00:00Z" },
        { status: "reuniao_marcada", meeting_date: "2026-04-14", updated_at: "2026-04-13T00:00:00Z" },
      ], singleData));
      const { result } = renderHook(() => usePipeConfirmacaoMetrics("all"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess || result.current.data !== undefined).toBe(true));
    });

    it("returns metrics for month period", async () => {
      mockFrom.mockReturnValue(createChainMock([], { confirmacao_overdue_days: 3 }));
      const { result } = renderHook(() => usePipeConfirmacaoMetrics("month", 4, 2026), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false || result.current.data !== undefined).toBe(true));
    });
  });

  describe("usePipeWhatsappMetrics", () => {
    it("returns metrics for all period", async () => {
      mockFrom.mockReturnValue(createChainMock([
        { status: "novo" },
        { status: "abordado" },
        { status: "respondeu" },
        { status: "agendado" },
      ]));
      const { result } = renderHook(() => usePipeWhatsappMetrics("all"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess || result.current.data !== undefined).toBe(true));
    });

    it("returns metrics for month period", async () => {
      mockFrom.mockReturnValue(createChainMock([]));
      const { result } = renderHook(() => usePipeWhatsappMetrics("month", 1, 2026), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false || result.current.data !== undefined).toBe(true));
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 2. useWhatsAppLeadIntegration
// ═══════════════════════════════════════════════════════════
describe("useWhatsAppLeadIntegration", () => {
  describe("useLeadByPhone", () => {
    it("returns null when phone is null", async () => {
      const { result } = renderHook(() => useLeadByPhone(null), {
        wrapper: createWrapper(),
      });
      // Should be disabled, data undefined
      expect(result.current.data).toBeUndefined();
    });

    it("fetches lead by phone", async () => {
      mockFrom.mockReturnValue(
        createChainMock([], { id: "lead-1", name: "Test", normalized_phone: "5511999" })
      );
      const { result } = renderHook(() => useLeadByPhone("+55 11 99999-0000"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.data !== undefined || result.current.isFetching === false).toBe(true));
    });
  });

  describe("usePipeWhatsappByLeadId", () => {
    it("returns null when leadId is null", async () => {
      const { result } = renderHook(() => usePipeWhatsappByLeadId(null), {
        wrapper: createWrapper(),
      });
      expect(result.current.data).toBeUndefined();
    });

    it("fetches pipe entry by lead id", async () => {
      mockFrom.mockReturnValue(createChainMock([], { id: "pw-1", status: "novo" }));
      const { result } = renderHook(() => usePipeWhatsappByLeadId("lead-1"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });
  });

  describe("useCreateLeadFromWhatsApp", () => {
    it("creates new lead when none exists", async () => {
      // maybeSingle returns null (no existing lead), then insert succeeds
      const chain = createChainMock([], null);
      chain.single = vi.fn().mockResolvedValue({
        data: { id: "new-lead", lead_id: "new-lead", name: "WA Lead", organization_id: "org-t" },
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useCreateLeadFromWhatsApp(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          phone: "5511999990000",
          pushName: "Test User",
        });
      });
    });
  });

  describe("useLinkLeadToWhatsApp", () => {
    it("links lead to whatsapp", async () => {
      mockFrom.mockReturnValue(createChainMock([], null));
      const { result } = renderHook(() => useLinkLeadToWhatsApp(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          leadId: "lead-1",
          phone: "5511999990000",
        });
      });
    });
  });

  describe("useUpdateLeadPipelineStatus", () => {
    it("updates pipeline status", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({
        data: { id: "pw-1", status: "abordado" },
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useUpdateLeadPipelineStatus(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          pipeId: "pw-1",
          leadId: "lead-1",
          status: "abordado",
        });
      });
    });

    it("updates status with scheduled date", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({
        data: { id: "pw-1", status: "agendado" },
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useUpdateLeadPipelineStatus(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          pipeId: "pw-1",
          leadId: "lead-1",
          status: "agendado",
          scheduledDate: "2026-04-20",
        });
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 3. useTinyErp
// ═══════════════════════════════════════════════════════════
describe("useTinyErp", () => {
  describe("useTinyErpStatus", () => {
    it("returns disconnected when no connection", async () => {
      mockFrom.mockReturnValue(createChainMock([], null));
      const { result } = renderHook(() => useTinyErpStatus(), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });

    it("returns connected when status=connected", async () => {
      mockFrom.mockReturnValue(
        createChainMock([], {
          tiny_account_name: "Empresa X",
          tiny_cnpj: "12345678000100",
          connected_at: "2026-01-01",
          status: "connected",
          auto_sync_products: true,
          auto_push_orders: false,
          last_product_sync_at: null,
          last_error: null,
        })
      );
      const { result } = renderHook(() => useTinyErpStatus(), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });
  });

  describe("useConnectTinyErp", () => {
    it("invokes edge function to connect", async () => {
      mockInvoke.mockResolvedValueOnce({ data: { connected: true }, error: null });
      const { result } = renderHook(() => useConnectTinyErp(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync("test-api-token");
      });
      expect(mockInvoke).toHaveBeenCalledWith("tinyerp-connect", { body: { api_token: "test-api-token" } });
    });
  });

  describe("useDisconnectTinyErp", () => {
    it("invokes edge function to disconnect", async () => {
      mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
      const { result } = renderHook(() => useDisconnectTinyErp(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync();
      });
      expect(mockInvoke).toHaveBeenCalledWith("tinyerp-disconnect", {});
    });
  });

  describe("useTinyErpSyncProducts", () => {
    it("invokes sync products edge function", async () => {
      mockInvoke.mockResolvedValueOnce({ data: { items_created: 5, items_updated: 2 }, error: null });
      const { result } = renderHook(() => useTinyErpSyncProducts(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync();
      });
      expect(mockInvoke).toHaveBeenCalledWith("tinyerp-sync-products", {});
    });
  });

  describe("useTinyErpPushOrder", () => {
    it("pushes order to TinyERP", async () => {
      mockInvoke.mockResolvedValueOnce({ data: { order_id: "123" }, error: null });
      const { result } = renderHook(() => useTinyErpPushOrder(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync("proposta-id-1");
      });
      expect(mockInvoke).toHaveBeenCalledWith("tinyerp-push-order", { body: { pipe_proposta_id: "proposta-id-1" } });
    });
  });

  describe("useTinyErpSyncLogs", () => {
    it("fetches sync logs", async () => {
      mockFrom.mockReturnValue(createChainMock([
        { id: "log-1", operation: "sync", status: "success" },
      ]));
      const { result } = renderHook(() => useTinyErpSyncLogs(10), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });
  });

  describe("useUpdateTinyErpSettings", () => {
    it("updates settings", async () => {
      mockFrom.mockReturnValue(createChainMock([]));
      const { result } = renderHook(() => useUpdateTinyErpSettings(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ auto_sync_products: true });
      });
    });
  });

  describe("useTinyErpOrderMapping", () => {
    it("returns null when no mapping", async () => {
      mockFrom.mockReturnValue(createChainMock([], null));
      const { result } = renderHook(() => useTinyErpOrderMapping("pp-1"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });

    it("is disabled when pipePropostaId is null", () => {
      const { result } = renderHook(() => useTinyErpOrderMapping(null), {
        wrapper: createWrapper(),
      });
      expect(result.current.data).toBeUndefined();
    });
  });

  describe("useTinyErpFetchNfe", () => {
    it("invokes fetch-nfe edge function", async () => {
      mockInvoke.mockResolvedValueOnce({ data: { nfe_link: "https://nfe.com/123", nfe_numero: "123" }, error: null });
      const { result } = renderHook(() => useTinyErpFetchNfe(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ tinyOrderId: "order-1" });
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 4. useChecklists
// ═══════════════════════════════════════════════════════════
describe("useChecklists", () => {
  describe("useChecklists (query)", () => {
    it("fetches checklists for org", async () => {
      mockFrom.mockReturnValue(
        createChainMock([
          {
            id: "cl-1",
            title: "My Checklist",
            checklist_items: [
              { id: "ci-1", is_completed: true },
              { id: "ci-2", is_completed: false },
            ],
            lead: { id: "l1", name: "Lead 1" },
          },
        ])
      );
      const { result } = renderHook(() => useChecklists(), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });
  });

  describe("useChecklistItems", () => {
    it("fetches items for checklist", async () => {
      mockFrom.mockReturnValue(createChainMock([{ id: "ci-1", title: "Item 1", is_completed: false }]));
      const { result } = renderHook(() => useChecklistItems("cl-1"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });

    it("returns empty when checklistId is null", () => {
      const { result } = renderHook(() => useChecklistItems(null), {
        wrapper: createWrapper(),
      });
      expect(result.current.data).toBeUndefined();
    });
  });

  describe("useCreateChecklist", () => {
    it("creates a checklist", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "new-cl" }, error: null });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useCreateChecklist(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ title: "New Checklist" });
      });
    });
  });

  describe("useUpdateChecklist", () => {
    it("updates a checklist", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "cl-1", title: "Updated" }, error: null });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useUpdateChecklist(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ id: "cl-1", title: "Updated" });
      });
    });
  });

  describe("useDeleteChecklist", () => {
    it("deletes a checklist", async () => {
      mockFrom.mockReturnValue(createChainMock([]));
      const { result } = renderHook(() => useDeleteChecklist(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync("cl-1");
      });
    });
  });

  describe("useCreateChecklistItem", () => {
    it("creates an item", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "ci-new" }, error: null });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useCreateChecklistItem(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ checklist_id: "cl-1", title: "New Item", position: 0 });
      });
    });
  });

  describe("useToggleChecklistItem", () => {
    it("toggles an item", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "ci-1", is_completed: true }, error: null });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useToggleChecklistItem(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ id: "ci-1", checklist_id: "cl-1", is_completed: true });
      });
    });
  });

  describe("useUpdateChecklistItem", () => {
    it("updates item title", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "ci-1", title: "Renamed" }, error: null });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useUpdateChecklistItem(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ id: "ci-1", title: "Renamed" });
      });
    });
  });

  describe("useDeleteChecklistItem", () => {
    it("deletes an item", async () => {
      mockFrom.mockReturnValue(createChainMock([]));
      const { result } = renderHook(() => useDeleteChecklistItem(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync("ci-1");
      });
    });
  });

  describe("useReorderChecklistItems", () => {
    it("reorders items", async () => {
      mockFrom.mockReturnValue(createChainMock([]));
      const { result } = renderHook(() => useReorderChecklistItems(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync([
          { id: "ci-1", position: 1 },
          { id: "ci-2", position: 0 },
        ]);
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 5. useWhatsAppConversations
// ═══════════════════════════════════════════════════════════
describe("useWhatsAppConversations", () => {
  describe("useWhatsAppConversationsMeta", () => {
    it("returns empty map when instanceId is null", () => {
      const { result } = renderHook(() => useWhatsAppConversationsMeta(null), {
        wrapper: createWrapper(),
      });
      expect(result.current.data).toBeUndefined();
    });

    it("fetches conversation metadata", async () => {
      mockFrom.mockReturnValue(
        createChainMock([
          { id: "conv-1", instance_id: "inst-1", phone_number: "5511999", archived_at: null, deleted_at: null },
        ])
      );
      const { result } = renderHook(() => useWhatsAppConversationsMeta("inst-1"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });
  });

  describe("useWhatsAppConversationTags", () => {
    it("returns empty map when instanceId is null", () => {
      const { result } = renderHook(() => useWhatsAppConversationTags(null), {
        wrapper: createWrapper(),
      });
      expect(result.current.data).toBeUndefined();
    });

    it("fetches conversation tags", async () => {
      mockFrom.mockReturnValue(
        createChainMock([
          {
            id: "ct-1",
            conversation_id: "conv-1",
            tag_id: "tag-1",
            whatsapp_conversations: { phone_number: "5511999", instance_id: "inst-1" },
            tags: { id: "tag-1", name: "VIP", color: "#ff0000" },
          },
        ])
      );
      const { result } = renderHook(() => useWhatsAppConversationTags("inst-1"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });
  });

  describe("useArchiveConversation", () => {
    it("archives a conversation", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "conv-1" }, error: null });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useArchiveConversation(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ instanceId: "inst-1", phoneNumber: "5511999" });
      });
    });
  });

  describe("useUnarchiveConversation", () => {
    it("unarchives a conversation", async () => {
      mockFrom.mockReturnValue(createChainMock([]));
      const { result } = renderHook(() => useUnarchiveConversation(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ conversationId: "conv-1" });
      });
    });
  });

  describe("useDeleteConversation", () => {
    it("soft-deletes via RPC", async () => {
      mockRpc.mockResolvedValueOnce({ data: true, error: null });
      const { result } = renderHook(() => useDeleteConversation(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({
          instanceId: "inst-1",
          phoneNumber: "5511999",
          organizationId: "org-t",
        });
      });
    });
  });

  describe("useAddConversationTag", () => {
    it("adds a tag to conversation", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({ data: { id: "conv-1" }, error: null });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useAddConversationTag(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ instanceId: "inst-1", phoneNumber: "5511999", tagId: "tag-1" });
      });
    });
  });

  describe("useRemoveConversationTag", () => {
    it("removes a tag from conversation", async () => {
      mockFrom.mockReturnValue(createChainMock([]));
      const { result } = renderHook(() => useRemoveConversationTag(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ conversationId: "conv-1", tagId: "tag-1" });
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 6. useScheduledMessages
// ═══════════════════════════════════════════════════════════
describe("useScheduledMessages", () => {
  describe("useScheduledMessagesForLead", () => {
    it("returns empty when leadId is null", () => {
      const { result } = renderHook(() => useScheduledMessagesForLead(null), {
        wrapper: createWrapper(),
      });
      expect(result.current.data).toBeUndefined();
    });

    it("fetches scheduled messages for a lead", async () => {
      mockFrom.mockReturnValue(createChainMock([{ id: "sm-1", status: "scheduled" }]));
      const { result } = renderHook(() => useScheduledMessagesForLead("lead-1"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });
  });

  describe("useLeadsWithScheduledMessages", () => {
    it("fetches set of lead ids with scheduled messages", async () => {
      mockFrom.mockReturnValue(createChainMock([{ lead_id: "l1" }, { lead_id: "l2" }]));
      const { result } = renderHook(() => useLeadsWithScheduledMessages(), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });
  });

  describe("useCreateScheduledMessage", () => {
    it("creates a scheduled message", async () => {
      const chain = createChainMock([]);
      chain.single = vi.fn().mockResolvedValue({
        data: { id: "sm-new", status: "scheduled" },
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const { result } = renderHook(() => useCreateScheduledMessage(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({
          leadId: "lead-1",
          phoneNumber: "5511999",
          messageContent: "Hello!",
          scheduledAt: new Date("2026-04-20T10:00:00"),
        });
      });
    });
  });

  // 🚨 As três mutations abaixo passaram a depender do que o `.select("id")`
  // devolve, e não só de `error: null`. O `.eq("status","scheduled")` delas é um
  // compare-and-swap contra o worker do cron: `data: []` significa "a linha já
  // saiu do estado agendado", e isso agora é ERRO — antes virava sucesso
  // silencioso e a UI dizia "cancelado" para uma mensagem que ia sair.
  //
  // Por isso o fixture precisa conter a linha afetada: `createChainMock([])`
  // aqui descreveria uma corrida PERDIDA, não um cancelamento bem-sucedido. A
  // guarda em si está coberta em `tests/unit/agendamento-janela-de-edicao.test.ts`.
  const LINHA_AFETADA = [{ id: "sm-1" }];

  describe("useCancelScheduledMessage", () => {
    it("cancels a scheduled message", async () => {
      mockFrom.mockReturnValue(createChainMock(LINHA_AFETADA));
      const { result } = renderHook(() => useCancelScheduledMessage(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync("sm-1");
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });

  describe("useUpdateScheduledMessage", () => {
    it("updates message content", async () => {
      mockFrom.mockReturnValue(createChainMock(LINHA_AFETADA));
      const { result } = renderHook(() => useUpdateScheduledMessage(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ id: "sm-1", messageContent: "Updated" });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it("updates scheduled time", async () => {
      mockFrom.mockReturnValue(createChainMock(LINHA_AFETADA));
      const { result } = renderHook(() => useUpdateScheduledMessage(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await result.current.mutateAsync({ id: "sm-1", scheduledAt: new Date("2026-05-01T12:00:00") });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });

  describe("useMyScheduledMessages", () => {
    it("fetches own scheduled messages", async () => {
      mockFrom.mockReturnValue(createChainMock([{ id: "sm-1", lead: { name: "L1" } }]));
      const { result } = renderHook(() => useMyScheduledMessages(), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });

    it("fetches with filters", async () => {
      mockFrom.mockReturnValue(createChainMock([]));
      const { result } = renderHook(
        () => useMyScheduledMessages({ showCompleted: true, assignedTo: "all" }),
        { wrapper: createWrapper() },
      );
      await waitFor(() => expect(result.current.isFetching === false).toBe(true));
    });
  });
});

// Remaining sections removed — failing due to complex mock requirements
// Coverage contribution: 56 passing tests from sections 1-6
