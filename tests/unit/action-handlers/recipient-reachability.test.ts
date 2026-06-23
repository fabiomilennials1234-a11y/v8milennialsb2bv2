// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

// getWhatsAppProvider is resolved inside the helper; mock it so we control the
// provider's checkNumbers verdict without touching the real Uazapi client.
vi.mock("../../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn(),
}));

import { getWhatsAppProvider } from "../../../supabase/functions/_shared/whatsapp-client";
import {
  assertRecipientReachable,
  assertRecipientReachableWithProvider,
  recipientGate,
} from "../../../supabase/functions/_shared/action-handlers/whatsapp-helpers";

const INSTANCE = { id: "inst-1", provider: "uazapi", organization_id: "org-1" };
const PHONE = "5511951674282";

function withProvider(checkNumbers?: unknown) {
  vi.mocked(getWhatsAppProvider).mockResolvedValue({
    provider: "uazapi",
    checkNumbers,
  } as never);
}

describe("assertRecipientReachable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gates (not reachable) when Uazapi reports isInWhatsapp:false", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    const checkNumbers = vi
      .fn()
      .mockResolvedValue([{ number: PHONE, isInWhatsapp: false }]);
    withProvider(checkNumbers);

    const res = await assertRecipientReachable(sb, INSTANCE, PHONE);

    expect(res.reachable).toBe(false);
    expect(res.reason).toContain("not on WhatsApp");
    expect(checkNumbers).toHaveBeenCalledWith([PHONE]);
  });

  it("allows when isInWhatsapp:true", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    withProvider(vi.fn().mockResolvedValue([{ number: PHONE, isInWhatsapp: true }]));

    const res = await assertRecipientReachable(sb, INSTANCE, PHONE);
    expect(res.reachable).toBe(true);
  });

  it("skips the check for numbers with prior WhatsApp history (fast path)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", [{ id: "m1", phone_number: PHONE }]);
    const checkNumbers = vi.fn();
    withProvider(checkNumbers);

    const res = await assertRecipientReachable(sb, INSTANCE, PHONE);

    expect(res.reachable).toBe(true);
    expect(getWhatsAppProvider).not.toHaveBeenCalled();
    expect(checkNumbers).not.toHaveBeenCalled();
  });

  it("does not gate when the provider lacks checkNumbers (Evolution/Meta)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    withProvider(undefined);

    const res = await assertRecipientReachable(sb, INSTANCE, PHONE);
    expect(res.reachable).toBe(true);
  });

  it("does not gate when the check itself throws (disconnected / infra noise)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    withProvider(
      vi.fn().mockRejectedValue(new Error("WhatsApp client is not connected")),
    );

    const res = await assertRecipientReachable(sb, INSTANCE, PHONE);
    expect(res.reachable).toBe(true);
  });
});

describe("assertRecipientReachableWithProvider (pre-resolved provider)", () => {
  beforeEach(() => vi.clearAllMocks());

  const provider = (checkNumbers?: unknown) => ({ provider: "uazapi", checkNumbers } as never);

  it("gates on isInWhatsapp:false WITHOUT resolving a provider", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    const checkNumbers = vi.fn().mockResolvedValue([{ number: PHONE, isInWhatsapp: false }]);

    const res = await assertRecipientReachableWithProvider(sb, provider(checkNumbers), PHONE, "org-1");

    expect(res.reachable).toBe(false);
    expect(getWhatsAppProvider).not.toHaveBeenCalled();
    expect(checkNumbers).toHaveBeenCalledWith([PHONE]);
  });

  it("skips the check for numbers with prior history (org-scoped)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", [{ id: "m1", phone_number: PHONE, organization_id: "org-1" }]);
    const checkNumbers = vi.fn();

    const res = await assertRecipientReachableWithProvider(sb, provider(checkNumbers), PHONE, "org-1");

    expect(res.reachable).toBe(true);
    expect(checkNumbers).not.toHaveBeenCalled();
  });

  it("does not gate when the check throws (infra noise)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    const res = await assertRecipientReachableWithProvider(
      sb,
      provider(vi.fn().mockRejectedValue(new Error("not connected"))),
      PHONE,
      "org-1",
    );
    expect(res.reachable).toBe(true);
  });
});

describe("recipientGate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a non-retryable failure ActionResult when unreachable", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    withProvider(vi.fn().mockResolvedValue([{ number: PHONE, isInWhatsapp: false }]));

    const gate = await recipientGate(sb, INSTANCE, PHONE);

    expect(gate).not.toBeNull();
    expect(gate?.success).toBe(false);
    expect(gate?.retryable).toBe(false);
    expect(gate?.error).toContain("not on WhatsApp");
  });

  it("returns null (proceed) when reachable", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    withProvider(vi.fn().mockResolvedValue([{ number: PHONE, isInWhatsapp: true }]));

    const gate = await recipientGate(sb, INSTANCE, PHONE);
    expect(gate).toBeNull();
  });
});
