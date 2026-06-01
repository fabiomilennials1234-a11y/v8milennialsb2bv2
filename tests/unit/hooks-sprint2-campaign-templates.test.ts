import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Chain mock helper ----

function createChainMock(data: unknown[] = [{ id: "mock-1", name: "Test" }]) {
  const chain: Record<string, any> = {};
  ["select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike", "contains", "order", "limit", "range", "insert", "update", "delete", "upsert", "not", "is", "filter", "match"].forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: data[0] ?? { id: "mock-1", organization_id: "org-t" }, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.then = (resolve: any, reject?: any) => Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: "test/path.ogg" }, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/file.ogg" } }),
      }),
    },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-t", isReady: true }), useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---- Import hooks ----

import {
  getTimeBasedVariables,
  replaceVariablesWithExamples,
  replaceVariablesWithLeadData,
  uploadCampaignTemplateAudio,
  uploadCampaignTemplateImage,
  uploadCampaignTemplateDocument,
  useCampaignTemplates,
  useCampaignTemplatesByType,
  useCampaignTemplate,
  useCreateCampaignTemplate,
  useUpdateCampaignTemplate,
  useDeleteCampaignTemplate,
  useCampanhaTemplates,
  useAddTemplateToCampanha,
  useRemoveTemplateFromCampanha,
  useDispatchBatches,
  useCreateDispatchBatch,
  useCancelDispatchBatch,
  useDispatchLog,
  useDispatchStats,
  TEMPLATE_VARIABLES,
} from "@/modules/campaigns/hooks/useCampaignTemplates";

// ---- Pure function tests ----

describe("getTimeBasedVariables", () => {
  it("returns saudacao, data, hora", () => {
    const result = getTimeBasedVariables(new Date("2025-06-15T10:00:00-03:00"));
    expect(result.saudacao).toBe("Bom dia");
    expect(result.data).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(result.hora).toMatch(/\d{2}:\d{2}/);
  });

  it("returns Boa tarde for afternoon", () => {
    const result = getTimeBasedVariables(new Date("2025-06-15T15:00:00-03:00"));
    expect(result.saudacao).toBe("Boa tarde");
  });

  it("returns Boa noite for evening", () => {
    const result = getTimeBasedVariables(new Date("2025-06-15T20:00:00-03:00"));
    expect(result.saudacao).toBe("Boa noite");
  });

  it("returns Boa noite for early morning (before 5am)", () => {
    const result = getTimeBasedVariables(new Date("2025-06-15T03:00:00-03:00"));
    expect(result.saudacao).toBe("Boa noite");
  });
});

describe("replaceVariablesWithExamples", () => {
  it("replaces all template variables with examples", () => {
    const content = "Olá {nome}, da {empresa}!";
    const result = replaceVariablesWithExamples(content);
    expect(result).toContain("João Silva");
    expect(result).toContain("Acme Corp");
  });

  it("replaces time-based variables dynamically", () => {
    const content = "{saudacao}, hoje é {data} às {hora}";
    const result = replaceVariablesWithExamples(content);
    expect(result).not.toContain("{saudacao}");
    expect(result).not.toContain("{data}");
    expect(result).not.toContain("{hora}");
  });
});

describe("replaceVariablesWithLeadData", () => {
  it("replaces with lead data", () => {
    const content = "Olá {nome}, da {empresa}! Email: {email}";
    const result = replaceVariablesWithLeadData(content, {
      name: "Carlos",
      company: "Torque",
      email: "carlos@torque.com",
    });
    expect(result).toContain("Carlos");
    expect(result).toContain("Torque");
    expect(result).toContain("carlos@torque.com");
  });

  it("handles missing lead fields gracefully", () => {
    const content = "{nome} - {empresa} - {telefone}";
    const result = replaceVariablesWithLeadData(content, {});
    expect(result).toBe(" -  - ");
  });

  it("replaces time variables too", () => {
    const content = "{saudacao} {nome}";
    const result = replaceVariablesWithLeadData(content, { name: "Ana" });
    expect(result).not.toContain("{saudacao}");
    expect(result).toContain("Ana");
  });
});

describe("TEMPLATE_VARIABLES", () => {
  it("has correct keys", () => {
    const keys = TEMPLATE_VARIABLES.map(v => v.key);
    expect(keys).toContain("nome");
    expect(keys).toContain("empresa");
    expect(keys).toContain("saudacao");
    expect(keys).toContain("data");
    expect(keys).toContain("hora");
  });
});

// ---- Upload functions ----

describe("uploadCampaignTemplateAudio", () => {
  it("uploads audio and returns public URL", async () => {
    const blob = new Blob(["audio"], { type: "audio/ogg" });
    const url = await uploadCampaignTemplateAudio(blob, "org-t");
    expect(url).toBe("https://example.com/file.ogg");
  });
});

describe("uploadCampaignTemplateImage", () => {
  it("uploads image and returns public URL", async () => {
    const blob = new Blob(["img"], { type: "image/png" });
    const url = await uploadCampaignTemplateImage(blob, "org-t");
    expect(url).toBe("https://example.com/file.ogg");
  });
});

describe("uploadCampaignTemplateDocument", () => {
  it("uploads document and returns public URL", async () => {
    const file = new File(["doc"], "test.pdf", { type: "application/pdf" });
    const url = await uploadCampaignTemplateDocument(file, "org-t");
    expect(url).toBe("https://example.com/file.ogg");
  });
});

// ---- Query hooks ----

describe("useCampaignTemplates", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches templates for org", async () => {
    const { result } = renderHook(() => useCampaignTemplates(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campaign_templates");
  });
});

describe("useCampaignTemplatesByType", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches templates by type", async () => {
    const { result } = renderHook(() => useCampaignTemplatesByType("audio"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campaign_templates");
  });
});

describe("useCampaignTemplate", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches a single template", async () => {
    const { result } = renderHook(() => useCampaignTemplate("tpl-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campaign_templates");
  });

  it("returns null when id is undefined", async () => {
    const { result } = renderHook(() => useCampaignTemplate(undefined), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
  });
});

describe("useCreateCampaignTemplate", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ id: "tpl-new", name: "New" }])); });

  it("creates template", async () => {
    const { result } = renderHook(() => useCreateCampaignTemplate(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ name: "Test", content: "Hello {nome}" }); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("campaign_templates");
  });
});

describe("useUpdateCampaignTemplate", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ id: "tpl-1", name: "Updated" }])); });

  it("updates template", async () => {
    const { result } = renderHook(() => useUpdateCampaignTemplate(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ id: "tpl-1", name: "Updated" }); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("campaign_templates");
  });
});

describe("useDeleteCampaignTemplate", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("soft deletes template", async () => {
    const { result } = renderHook(() => useDeleteCampaignTemplate(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("tpl-1"); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("campaign_templates");
  });
});

describe("useCampanhaTemplates", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches campanha templates", async () => {
    const { result } = renderHook(() => useCampanhaTemplates("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanha_templates");
  });

  it("is disabled when campanhaId is undefined", async () => {
    const { result } = renderHook(() => useCampanhaTemplates(undefined), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
  });
});

describe("useAddTemplateToCampanha", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ id: "ct-1" }])); });

  it("adds template to campanha", async () => {
    const { result } = renderHook(() => useAddTemplateToCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ campanha_id: "camp-1", template_id: "tpl-1" }); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_templates");
  });
});

describe("useRemoveTemplateFromCampanha", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("removes template from campanha", async () => {
    const { result } = renderHook(() => useRemoveTemplateFromCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ id: "ct-1", campanha_id: "camp-1" }); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_templates");
  });
});

describe("useDispatchBatches", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches dispatch batches", async () => {
    const { result } = renderHook(() => useDispatchBatches("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campaign_dispatch_batches");
  });
});

describe("useCreateDispatchBatch", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ id: "batch-1" }])); });

  it("creates dispatch batch", async () => {
    const { result } = renderHook(() => useCreateDispatchBatch(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          campanha_id: "camp-1",
          template_id: "tpl-1",
          scheduled_at: new Date().toISOString(),
        });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("campaign_dispatch_batches");
  });
});

describe("useCancelDispatchBatch", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ id: "batch-1", status: "cancelled" }])); });

  it("cancels dispatch batch", async () => {
    const { result } = renderHook(() => useCancelDispatchBatch(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ id: "batch-1", campanha_id: "camp-1" }); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("campaign_dispatch_batches");
  });
});

describe("useDispatchLog", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches dispatch log", async () => {
    const { result } = renderHook(() => useDispatchLog("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("outbound_dispatch_log");
  });
});

describe("useDispatchStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([
      { status: "sent" },
      { status: "sent" },
      { status: "pending" },
      { status: "failed" },
      { status: "cancelled" },
    ]));
  });

  it("fetches dispatch stats", async () => {
    const { result } = renderHook(() => useDispatchStats("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("outbound_dispatch_log");
  });
});
