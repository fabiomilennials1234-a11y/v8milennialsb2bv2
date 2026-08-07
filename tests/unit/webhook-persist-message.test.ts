// @vitest-environment node
/**
 * Unit tests for persistMessage — extracted from handleMessagesEvent.
 *
 * Verifies:
 * 1. Returns PersistedMessage on successful upsert
 * 2. Upsert falhou + DLQ estacionou → null (o 200 ao Uazapi é honesto)
 * 3. Upsert falhou + DLQ falhou → LANÇA `message_lost` (5xx → reentrega)
 * 4. Returns null for groups with capture_groups=false
 * 5. Returns null for groups (persist-only, no downstream reactions)
 * 6. Fires media persist for CDN URLs
 *
 * O item 3 é a garantia mais nova e a que não tinha cobertura. Ela existe porque
 * devolver `null` quando NENHUMA cópia da mensagem sobreviveu fazia o handler
 * responder 200 e o provedor marcar como entregue — mensagem de cliente sumindo
 * em silêncio. Ver `whatsapp-webhook/index.ts:948-953`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Stubs ─────────────────────────────────��───────────────────────���─────────

const envStub: Record<string, string> = {
  SUPABASE_URL: "https://local.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  UAZAPI_WEBHOOK_SECRET: "test-secret",
  UAZAPI_BASE_URL: "https://uazapi.test",
};

vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => envStub[k] ?? undefined,
    toObject: () => ({ ...envStub }),
  },
  serve: (_handler: unknown) => {},
});

const mockLogRuntime = vi.fn(async () => {});
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: (...args: unknown[]) => mockLogRuntime(...args),
  redactSecrets: (v: unknown) => v,
}));

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, fn: unknown) => fn,
}));

vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));

vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  upsertPipeEntry: vi.fn(async () => ({})),
}));

vi.mock("../../supabase/functions/_shared/copilot/cancellation.ts", () => ({
  isCopilotCanceled: vi.fn(async () => ({ canceled: false, source: "default", ai_disabled: false })),
  logCopilotCancellation: vi.fn(),
}));

const mockEnqueueMediaJob = vi.fn(async () => {});
const mockDownloadAndPersistMedia = vi.fn(async () => ({ ok: true }));
vi.mock("../../supabase/functions/_shared/whatsapp-media.ts", () => ({
  downloadAndPersistMedia: (...args: unknown[]) => mockDownloadAndPersistMedia(...args),
  enqueueMediaJob: (...args: unknown[]) => mockEnqueueMediaJob(...args),
  isWhatsAppCdnUrl: (url: string) => url.includes("mmg.whatsapp.net"),
  stampMediaJob: vi.fn(async () => {}),
}));

vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  timingSafeCompare: (a: string, b: string) => a === b,
  checkRateLimitPersistent: vi.fn(async () => ({ allowed: true, remaining: 100, resetAt: "" })),
}));

vi.stubGlobal("fetch", vi.fn());

// ─── Supabase mock factory ──────────���────────────────────────────────────────

let mockUpsertResult: { error: unknown } = { error: null };
let mockOrgData: unknown = { capture_groups: true };

/**
 * Resultado do INSERT na DLQ (`whatsapp_webhook_dlq`).
 *
 * A DLQ entrou no caminho de erro do `persistMessage` e o mock não a
 * acompanhou: o `from()` devolvia um objeto só com `upsert`, então
 * `enqueueDlq` chamava `.insert` em `undefined`, o catch marcava
 * `parked = false` e o `persistMessage` lançava `message_lost`. O teste
 * "returns null on upsert error" reprovava por causa do MOCK, não do código —
 * e a mensagem de falha (`message_lost`) parecia bug de produção.
 */
let mockDlqResult: { error: unknown } = { error: null };

const createMockSupabase = () => ({
  from: vi.fn((table: string) => {
    if (table === "whatsapp_messages") {
      return { upsert: vi.fn(async () => mockUpsertResult) };
    }
    if (table === "whatsapp_webhook_dlq") {
      return { insert: vi.fn(async () => mockDlqResult) };
    }
    if (table === "organizations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: mockOrgData })),
          })),
        })),
      };
    }
    // Fallback com as duas operações: tabela nova que caia aqui não deve
    // reprovar um teste por `undefined is not a function` — o que se quer
    // enxergar é a decisão do código, não o buraco do mock.
    return {
      upsert: vi.fn(async () => ({ error: null })),
      insert: vi.fn(async () => ({ error: null })),
    };
  }),
  rpc: vi.fn(async () => ({ error: null })),
});

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn(() => createMockSupabase()),
}));

// ─── Import ────────────────────────────────────────────────��─────────────────

const mod = await import("../../supabase/functions/whatsapp-webhook/index.ts");
const { persistMessage } = mod as unknown as {
  persistMessage: (
    supabase: ReturnType<typeof createMockSupabase>,
    instance: { id: string; organization_id: string; instance_name: string },
    normalized: Record<string, unknown>,
    replayTag: string | null,
  ) => Promise<Record<string, unknown> | null>;
};

// ─── Tests ────────────────────────────────���──────────────────────────────────

const mockInstance = { id: "inst-1", organization_id: "org-1", instance_name: "Test" };

const baseNormalized = {
  organization_id: "org-1",
  instance_id: "inst-1",
  message_id: "msg-abc",
  remote_jid: "5547999999999@s.whatsapp.net",
  phone_number: "5547999999999",
  direction: "incoming",
  message_type: "text",
  content: "Ola",
  media_url: null,
  push_name: "Lead",
  status: "received",
  timestamp: new Date().toISOString(),
  raw_payload: {},
  is_group: false,
};

describe("persistMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertResult = { error: null };
    mockDlqResult = { error: null };
    mockOrgData = { capture_groups: true };
  });

  it("returns PersistedMessage on successful upsert", async () => {
    const sb = createMockSupabase();
    const result = await persistMessage(sb, mockInstance, baseNormalized as any, null);

    expect(result).not.toBeNull();
    expect(result!.message_id).toBe("msg-abc");
    expect(result!.phone_number).toBe("5547999999999");
    expect(result!.organization_id).toBe("org-1");
  });

  it("upsert falhou mas a DLQ estacionou: devolve null (o 200 é honesto)", async () => {
    mockUpsertResult = { error: { message: "conflict" } };
    mockDlqResult = { error: null };
    const sb = createMockSupabase();
    const result = await persistMessage(sb, mockInstance, baseNormalized as any, null);

    expect(result).toBeNull();
    expect(mockLogRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "uazapi_messages_upsert_error",
      }),
    );
  });

  /**
   * A garantia que o `persistMessage` passou a dar, e que não tinha teste.
   *
   * Quando o upsert falha E a DLQ também, não sobrou cópia da mensagem em lugar
   * nenhum. Devolver `null` — como era antes — faria o handler responder 200 e o
   * Uazapi considerar entregue: a mensagem do cliente sumiria em silêncio, sem
   * reentrega. Lançar é o que produz 5xx e faz o provedor tentar de novo.
   *
   * Sem este caso, alguém "consertando" o `message_lost` para devolver null
   * deixaria a suíte verde e a perda de mensagem de volta.
   */
  it("upsert E DLQ falharam: LANÇA, para o provedor reentregar", async () => {
    mockUpsertResult = { error: { message: "conflict" } };
    mockDlqResult = { error: { message: "dlq indisponível" } };
    const sb = createMockSupabase();

    await expect(
      persistMessage(sb, mockInstance, baseNormalized as any, null),
    ).rejects.toThrow(/message_lost/);
  });

  it("returns null for group messages (persist-only path)", async () => {
    const sb = createMockSupabase();
    const groupMsg = { ...baseNormalized, is_group: true };
    const result = await persistMessage(sb, mockInstance, groupMsg as any, null);

    expect(result).toBeNull();
  });

  it("returns null and logs skip when capture_groups is false", async () => {
    mockOrgData = { capture_groups: false };
    const sb = createMockSupabase();
    const groupMsg = { ...baseNormalized, is_group: true };
    const result = await persistMessage(sb, mockInstance, groupMsg as any, null);

    expect(result).toBeNull();
    expect(mockLogRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "uazapi_group_message_skipped",
      }),
    );
  });

  it("triggers media persist for WhatsApp CDN URLs", async () => {
    const sb = createMockSupabase();
    const mediaMsg = {
      ...baseNormalized,
      media_url: "https://mmg.whatsapp.net/v/t62.7119-24/enc-media.jpg",
    };
    await persistMessage(sb, mockInstance, mediaMsg as any, null);

    await new Promise((r) => setTimeout(r, 10));
    expect(mockEnqueueMediaJob).toHaveBeenCalled();
  });

  it("does NOT trigger media persist for non-CDN URLs", async () => {
    const sb = createMockSupabase();
    const mediaMsg = {
      ...baseNormalized,
      media_url: "https://example.com/file.pdf",
    };
    await persistMessage(sb, mockInstance, mediaMsg as any, null);

    await new Promise((r) => setTimeout(r, 10));
    expect(mockEnqueueMediaJob).not.toHaveBeenCalled();
  });

  it("DLQ payload contains event, reason, and resolved_instance_id", async () => {
    mockUpsertResult = { error: { message: "constraint violation" } };
    const dlqInsertSpy = vi.fn(async () => ({ error: null }));
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "whatsapp_webhook_dlq") {
          return { insert: dlqInsertSpy };
        }
        if (table === "whatsapp_messages") {
          return { upsert: vi.fn(async () => mockUpsertResult) };
        }
        if (table === "organizations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: mockOrgData })),
              })),
            })),
          };
        }
        return { insert: vi.fn(async () => ({ error: null })) };
      }),
      rpc: vi.fn(async () => ({ error: null })),
    };

    await persistMessage(sb, mockInstance, baseNormalized as any, null);

    expect(dlqInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "messages",
        reason: "upsert_failed",
        resolved_instance_id: "inst-1",
      }),
    );
  });

  it("returns PersistedMessage with correct shape on success", async () => {
    const sb = createMockSupabase();
    const result = await persistMessage(sb, mockInstance, baseNormalized as any, null);

    expect(result).toMatchObject({
      organization_id: "org-1",
      instance_id: "inst-1",
      message_id: "msg-abc",
      phone_number: "5547999999999",
      direction: "incoming",
      message_type: "text",
      content: "Ola",
    });
  });
});
