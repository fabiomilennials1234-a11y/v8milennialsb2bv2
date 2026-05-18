/**
 * Tests para src/lib/prefetch/chatPrefetch.ts.
 *
 * Garantia crítica: a chave de prefetch precisa bater EXATAMENTE com a
 * `chatQueryKeys.messages(orgId, phoneNumber, instanceId)` usada pelo hook
 * `useWhatsAppMessages`. Qualquer divergência rompe o reaproveitamento de
 * cache e o prefetch vira desperdício (ou, pior, populaa uma chave morta).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { chatQueryKeys } from "@/hooks/chat/shared/queryKeys";

// Mock do supabase client antes de importar o helper
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: "m1", phone_number: "5511999999999" }],
        error: null,
      }),
    })),
  },
}));

import { prefetchChatRoute, prefetchChatData } from "@/lib/prefetch/chatPrefetch";

describe("prefetchChatRoute", () => {
  it("é idempotente — chamadas repetidas reusam a mesma promise", async () => {
    const p1 = prefetchChatRoute();
    const p2 = prefetchChatRoute();
    expect(p1).toBe(p2);
  });
});

describe("prefetchChatData", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("não dispara fetch quando organizationId ausente", async () => {
    await prefetchChatData(queryClient, {
      organizationId: "",
      phoneNumber: "5511999999999",
      instanceId: "inst-1",
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("não dispara fetch quando phoneNumber ausente", async () => {
    await prefetchChatData(queryClient, {
      organizationId: "org-1",
      phoneNumber: "",
      instanceId: "inst-1",
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("não dispara fetch quando instanceId ausente (chave incompleta)", async () => {
    await prefetchChatData(queryClient, {
      organizationId: "org-1",
      phoneNumber: "5511999999999",
      // instanceId omitido a propósito
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("popula cache com a EXATA mesma chave usada por useWhatsAppMessages", async () => {
    const orgId = "org-abc";
    const phone = "5511999999999";
    const instanceId = "inst-xyz";

    await prefetchChatData(queryClient, {
      organizationId: orgId,
      phoneNumber: phone,
      instanceId,
    });

    const expectedKey = chatQueryKeys.messages(orgId, phone, instanceId);
    const cached = queryClient.getQueryData(expectedKey);
    expect(cached).toBeDefined();
    expect(cached).toEqual([{ id: "m1", phone_number: "5511999999999" }]);
  });
});
