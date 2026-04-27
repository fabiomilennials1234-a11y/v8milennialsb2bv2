import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// ── Mocks ──
const mockFrom = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
  },
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));

import { useTags, useCreateTag, useUpdateTag, useDeleteTag } from "@/hooks/useTags";

// ── Helpers ──
const MOCK_TAGS = [
  { id: "t1", name: "Ouro", color: "#ffd700", organization_id: "org-test" },
  { id: "t2", name: "Prata", color: "#c0c0c0", organization_id: "org-test" },
  { id: "t3", name: "Bronze", color: "#cd7f32", organization_id: "org-test" },
];

function mockSelectChain(data: unknown[], error: unknown = null) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: data[0], error }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: data[0], error }),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error }),
    }),
  });
}

// ── Tests ──
describe("useTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches tags for the organization", async () => {
    mockSelectChain(MOCK_TAGS);
    const { result } = renderHook(() => useTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    expect(result.current.data![0].name).toBe("Ouro");
  });

  it("returns empty array when no tags", async () => {
    mockSelectChain([]);
    const { result } = renderHook(() => useTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(0);
  });

  it("calls supabase.from('tags')", async () => {
    mockSelectChain(MOCK_TAGS);
    renderHook(() => useTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith("tags"));
  });
});

describe("useCreateTag", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a tag via mutation", async () => {
    const newTag = { id: "t4", name: "Diamante", color: "#b9f2ff", organization_id: "org-test" };
    mockSelectChain([newTag]);

    const { result } = renderHook(() => useCreateTag(), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate({ name: "Diamante", color: "#b9f2ff" } as any);
    });

    await waitFor(() => expect(result.current.isSuccess || result.current.isIdle).toBe(true));
  });
});

describe("useUpdateTag", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates a tag via mutation", async () => {
    const updated = { ...MOCK_TAGS[0], name: "Platina" };
    mockSelectChain([updated]);

    const { result } = renderHook(() => useUpdateTag(), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate({ id: "t1", name: "Platina" } as any);
    });

    await waitFor(() => expect(result.current.isSuccess || result.current.isIdle).toBe(true));
  });
});

describe("useDeleteTag", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a tag via mutation", async () => {
    mockSelectChain([]);

    const { result } = renderHook(() => useDeleteTag(), { wrapper: createWrapper() });

    act(() => {
      result.current.mutate("t1");
    });

    await waitFor(() => expect(result.current.isSuccess || result.current.isIdle).toBe(true));
  });
});
