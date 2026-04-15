/**
 * Tests for _shared/outbound-sender.ts — WhatsApp outbound dispatch via Evolution API
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

// ── Mock dependencies before importing the module ──

vi.mock("../../supabase/functions/_shared/message-humanizer", () => ({
  humanizeMessage: vi.fn(async (msg: string) => msg + " [humanized]"),
}));

vi.mock("../../supabase/functions/_shared/audio-sender", () => ({
  sendWhatsAppAudio: vi.fn(async () => ({ success: true, messageId: "audio-msg-id" })),
}));

vi.mock("../../supabase/functions/_shared/natural-messaging", () => ({
  smartSplitMessage: vi.fn(async (msg: string) => ({
    chunks: [msg],
    delays: [0],
  })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ key: { id: "msg-123" } }),
    text: () => Promise.resolve("ok"),
  });
});

import { sendOutboundDispatch } from "../../supabase/functions/_shared/outbound-sender";

// ── Helper: build a mock supabase client ──

function createOutboundMockSupabase(overrides: {
  dispatch?: any;
  dispatchError?: any;
  instance?: any;
  instanceByOrg?: any;
  audios?: any[];
  existingPipe?: any;
} = {}) {
  const updateCalls: Array<{ table: string; data: any; id: string }> = [];
  const insertCalls: Array<{ table: string; data: any }> = [];

  const sb: any = {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        single: async () => {
          if (table === "outbound_dispatch_log") {
            return { data: overrides.dispatch ?? null, error: overrides.dispatchError ?? null };
          }
          if (table === "whatsapp_instances") {
            // first call: by agent instance id; second: by org
            if (overrides.instance !== undefined) {
              const val = overrides.instance;
              overrides.instance = undefined; // consume it
              return { data: val, error: null };
            }
            return { data: overrides.instanceByOrg ?? null, error: null };
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          if (table === "whatsapp_instances") {
            return { data: overrides.instanceByOrg ?? null, error: null };
          }
          if (table === "pipe_whatsapp") {
            return { data: overrides.existingPipe ?? null, error: null };
          }
          return { data: null, error: null };
        },
        update: (data: any) => {
          const updateChain: any = {
            eq: (field: string, value: string) => {
              updateCalls.push({ table, data, id: value });
              return updateChain;
            },
            then: (resolve: any) => resolve({ data: null, error: null }),
          };
          updateChain[Symbol.toStringTag] = "Promise";
          updateChain.then = (onFulfilled?: any, onRejected?: any) =>
            Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
          updateChain.catch = (onRejected?: any) =>
            Promise.resolve({ data: null, error: null }).catch(onRejected);
          return updateChain;
        },
        insert: (data: any) => {
          insertCalls.push({ table, data });
          const insertChain: any = {};
          insertChain[Symbol.toStringTag] = "Promise";
          insertChain.then = (onFulfilled?: any, onRejected?: any) =>
            Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
          insertChain.catch = (onRejected?: any) =>
            Promise.resolve({ data: null, error: null }).catch(onRejected);
          return insertChain;
        },
      };
      return chain;
    },
    _updateCalls: updateCalls,
    _insertCalls: insertCalls,
  };
  return sb;
}

// ── Tests ──

describe("sendOutboundDispatch", () => {
  it("returns error when dispatch not found", async () => {
    const sb = createOutboundMockSupabase({ dispatchError: { message: "not found" } });
    const result = await sendOutboundDispatch(sb, "dispatch-1", "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Dispatch not found");
  });

  it("returns error when lead has no phone", async () => {
    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Hello",
        lead: { name: "Test" },
        agent: { whatsapp_instance_id: null, outbound_config: null },
      },
    });
    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Lead has no phone");
  });

  it("returns error when no WhatsApp instance found", async () => {
    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Hello",
        lead: { phone: "11999999999", name: "Test" },
        agent: { whatsapp_instance_id: null, outbound_config: null },
      },
      instanceByOrg: null,
    });
    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("No WhatsApp instance available");
  });

  it("returns error when Evolution API env is not configured", async () => {
    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Hello",
        lead: { phone: "11999999999", name: "Test" },
        agent: { whatsapp_instance_id: "inst-1", outbound_config: null },
      },
      instance: { instance_name: "my-instance" },
    });
    // No EVOLUTION_API_URL or EVOLUTION_API_KEY set
    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Evolution API not configured");
  });

  it("sends text successfully and updates dispatch log", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Hello lead!",
        lead: { phone: "11999999999", name: "Test Lead" },
        agent: { whatsapp_instance_id: "inst-1", outbound_config: null },
        trigger_reason: {},
      },
      instance: { instance_name: "my-instance" },
    });

    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(true);
    // Should have called fetch for presence + sendText
    expect(mockFetch).toHaveBeenCalled();
    // Check that the update for dispatch log was called (status: "sent")
    const sentUpdate = sb._updateCalls.find(
      (c: any) => c.table === "outbound_dispatch_log" && c.data.status === "sent"
    );
    expect(sentUpdate).toBeDefined();
  });

  it("prepends 55 to phone without country code", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Hello!",
        lead: { phone: "(11) 99999-9999", name: "Test" },
        agent: { whatsapp_instance_id: "inst-1", outbound_config: null },
        trigger_reason: {},
      },
      instance: { instance_name: "my-instance" },
    });

    await sendOutboundDispatch(sb, "d-1", "org-1");
    // The phone passed to fetch should be "5511999999999"
    const sendTextCall = mockFetch.mock.calls.find(
      (call: any) => call[0]?.includes("sendText")
    );
    expect(sendTextCall).toBeDefined();
    const body = JSON.parse(sendTextCall[1].body);
    expect(body.number).toBe("5511999999999");
  });

  it("handles text send failure", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    // First call: presence (ok), second call: sendText (fail)
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => ({}), text: () => "ok" }) // presence
      .mockResolvedValueOnce({ ok: false, text: () => Promise.resolve("API Error") }); // sendText

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Hello!",
        lead: { phone: "5511999999999", name: "Test" },
        agent: { whatsapp_instance_id: "inst-1", outbound_config: null },
        trigger_reason: {},
      },
      instance: { instance_name: "my-instance" },
    });

    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("API Error");
  });

  it("falls back to org instance when agent instance not found", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Fallback test",
        lead: { phone: "5511999999999", name: "Test" },
        agent: { whatsapp_instance_id: "inst-nonexistent", outbound_config: null },
        trigger_reason: {},
      },
      instance: null, // agent's instance not found
      instanceByOrg: { instance_name: "org-fallback-instance" },
    });

    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(true);
  });

  it("sends with audio_first order when audio enabled", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    // We need the module's sendWhatsAppAudio to be called
    const { sendWhatsAppAudio } = await import(
      "../../supabase/functions/_shared/audio-sender"
    );

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Audio first test",
        lead: { phone: "5511999999999", name: "Test" },
        agent: {
          whatsapp_instance_id: "inst-1",
          outbound_config: { audioEnabled: true, audioSendOrder: "audio_first" },
        },
        trigger_reason: {},
      },
      instance: { instance_name: "my-instance" },
    });

    // Override .from("copilot_agent_audios") to return audio records
    const origFrom = sb.from.bind(sb);
    sb.from = (table: string) => {
      if (table === "copilot_agent_audios") {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ id: "aud-1", public_url: "https://cdn.test/audio.ogg", name: "audio1" }],
                  error: null,
                }),
            }),
          }),
        };
      }
      return origFrom(table);
    };

    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(true);
    expect(sendWhatsAppAudio).toHaveBeenCalled();
  });

  it("inserts pipe_whatsapp when no existing entry", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Hello!",
        lead: { phone: "5511999999999", name: "Test" },
        agent: { whatsapp_instance_id: "inst-1", outbound_config: null },
        trigger_reason: {},
      },
      instance: { instance_name: "my-instance" },
      existingPipe: null,
    });

    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(true);
    const pipeInsert = sb._insertCalls.find((c: any) => c.table === "pipe_whatsapp");
    expect(pipeInsert).toBeDefined();
    expect(pipeInsert.data.status).toBe("abordado");
  });

  it("updates existing pipe_whatsapp when entry exists", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Hello!",
        lead: { phone: "5511999999999", name: "Test" },
        agent: { whatsapp_instance_id: "inst-1", outbound_config: null },
        trigger_reason: {},
      },
      instance: { instance_name: "my-instance" },
      existingPipe: { id: "pipe-existing-1" },
    });

    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(true);
    const pipeUpdate = sb._updateCalls.find((c: any) => c.table === "pipe_whatsapp");
    expect(pipeUpdate).toBeDefined();
  });

  it("catches unexpected exceptions and marks dispatch as failed", async () => {
    // Create a supabase that throws on the first .from() call
    const updateCalls: any[] = [];
    const sb: any = {
      from: (table: string) => {
        if (table === "outbound_dispatch_log") {
          // First call: select throws. Subsequent calls: update (for error handling)
          let callCount = 0;
          return {
            select: () => {
              throw new Error("Unexpected DB crash");
            },
            update: (data: any) => {
              const chain: any = {
                eq: () => {
                  updateCalls.push({ table, data });
                  return chain;
                },
              };
              chain[Symbol.toStringTag] = "Promise";
              chain.then = (onFulfilled?: any, onRejected?: any) =>
                Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
              chain.catch = (onRejected?: any) =>
                Promise.resolve({ data: null, error: null }).catch(onRejected);
              return chain;
            },
          };
        }
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
          update: () => {
            const c: any = { eq: () => c };
            c[Symbol.toStringTag] = "Promise";
            c.then = (f?: any) => Promise.resolve({ data: null, error: null }).then(f);
            c.catch = (f?: any) => Promise.resolve({ data: null, error: null }).catch(f);
            return c;
          },
        };
      },
    };

    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unexpected DB crash");
  });

  it("awaits inline delay between chunks when delay > 0", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    const { smartSplitMessage } = await import(
      "../../supabase/functions/_shared/natural-messaging"
    );
    (smartSplitMessage as any).mockResolvedValueOnce({
      chunks: ["part 1", "part 2", "part 3"],
      delays: [0, 5, 5], // tiny non-zero delays hit the setTimeout branch
    });

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "multi chunk",
        lead: { phone: "5511999999999", name: "Test" },
        agent: { whatsapp_instance_id: "inst-1", outbound_config: null },
        trigger_reason: {},
      },
      instance: { instance_name: "my-instance" },
    });

    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(true);
    // Should have 3 sendText + 3 typing indicator calls
    const sends = mockFetch.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("/message/sendText/"),
    );
    expect(sends).toHaveLength(3);
  });

  it("sends text first then schedules audio in background (audio after text)", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    const { sendWhatsAppAudio } = await import(
      "../../supabase/functions/_shared/audio-sender",
    );
    (sendWhatsAppAudio as any).mockClear();

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Text then audio",
        lead: { phone: "5511999999999", name: "Test" },
        agent: {
          whatsapp_instance_id: "inst-1",
          outbound_config: { audioEnabled: true }, // default order = text_first
        },
        trigger_reason: {},
      },
      instance: { instance_name: "my-instance" },
    });

    // Override copilot_agent_audios to return an audio record
    const origFrom = sb.from.bind(sb);
    sb.from = (table: string) => {
      if (table === "copilot_agent_audios") {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    { id: "aud-1", public_url: "https://cdn/a.ogg", name: "a1" },
                  ],
                  error: null,
                }),
            }),
          }),
        };
      }
      return origFrom(table);
    };

    const result = await sendOutboundDispatch(sb, "d-1", "org-1");
    expect(result.success).toBe(true);
    // Audio schedule is fire-and-forget via setTimeout — flush macrotasks
    await new Promise((r) => setTimeout(r, 0));
  });

  it("records whatsapp_messages insert for text", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo.test");
    setDenoEnv("EVOLUTION_API_KEY", "evo-key");

    const sb = createOutboundMockSupabase({
      dispatch: {
        id: "d-1",
        lead_id: "l-1",
        organization_id: "org-1",
        agent_id: "a-1",
        message_content: "Track this message",
        lead: { phone: "5511999999999", name: "Test" },
        agent: { whatsapp_instance_id: "inst-1", outbound_config: null },
        trigger_reason: {},
      },
      instance: { instance_name: "my-instance" },
    });

    await sendOutboundDispatch(sb, "d-1", "org-1");
    const msgInsert = sb._insertCalls.find(
      (c: any) => c.table === "whatsapp_messages" && c.data.message_type === "conversation"
    );
    expect(msgInsert).toBeDefined();
    expect(msgInsert.data.from_me).toBe(true);
    expect(msgInsert.data.content).toContain("[humanized]");
  });
});
