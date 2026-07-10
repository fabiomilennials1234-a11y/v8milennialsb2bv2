/**
 * SLICE 4 — Meta WhatsApp Cloud API inbound (meta-webhook extension).
 *
 * Pins the locked decisions from docs/meta-cloud-cert/CERTIFICATION.md (§5,
 * rules 8/11) for the WA Cloud branch of meta-webhook:
 *  - object='whatsapp_business_account' routes to the WA Cloud handler, never
 *    the Messenger/IG (channel_messages) path.
 *  - org/instance resolves strictly from metadata.phone_number_id →
 *    whatsapp_instance_secrets.meta_phone_number_id → active meta_cloud instance.
 *  - the REAL wamid is the whatsapp_messages.message_id (status callbacks land
 *    on the right row).
 *  - the write uses the idempotent webhook upsert contract
 *    (onConflict message_id,instance_id + ignoreDuplicates:true).
 *  - statuses (sent/delivered/read/failed) update by wamid.
 *  - an unprovisioned phone_number_id is rejected (logged + dropped, no write).
 *  - Messenger/IG path is unaffected.
 *
 * No network, no Deno.serve invocation: we polyfill Deno, mock supabase-js +
 * _shared deps, then import the pure/exported handlers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Env + module mocks (mirror whatsapp-webhook.test.ts wiring)
// ---------------------------------------------------------------------------

const envStub: Record<string, string> = {
  SUPABASE_URL: "https://local.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  META_WEBHOOK_VERIFY_TOKEN: "verify-token",
  META_APP_SECRET: "app-secret",
};

vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => envStub[k] ?? undefined,
    toObject: () => ({ ...envStub }),
  },
  serve: (_handler: unknown) => {},
});

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, fn: unknown) => fn,
}));

const logRuntime = vi.fn(async () => {});
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime,
  redactSecrets: (v: unknown) => v,
}));

vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));

vi.mock("../../supabase/functions/_shared/meta-api.ts", () => ({
  verifyWebhookSignature: () => true,
  getLeadgenData: vi.fn(),
}));

vi.mock("../../supabase/functions/_shared/campaign-distribution.ts", () => ({
  getCampaignResponsibleAssignment: vi.fn(),
}));

vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  timingSafeCompare: (a: string, b: string) => a === b,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn(() => ({ from: vi.fn() })),
}));

const mod = await import("../../supabase/functions/meta-webhook/index.ts");
const { processWhatsAppCloudEntry, normalizeCloudMessage } = mod as unknown as {
  processWhatsAppCloudEntry: (
    supabase: unknown,
    entry: Record<string, unknown>,
  ) => Promise<void>;
  normalizeCloudMessage: (
    msg: Record<string, unknown>,
    contactName: string | null,
  ) => {
    message_id: string;
    phone_number: string;
    message_type: string;
    content: string | null;
    media_url: string | null;
    push_name: string | null;
    timestamp: string;
  };
};

// ---------------------------------------------------------------------------
// Supabase test double — records upserts/updates, resolves lookups from a fixture.
// ---------------------------------------------------------------------------

interface Capture {
  upserts: Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }>;
  updates: Array<{ payload: Record<string, unknown>; filters: Record<string, unknown> }>;
  tablesTouched: string[];
}

function makeSupabase(opts: {
  secretRow?: Record<string, unknown> | null;
  instanceRow?: Record<string, unknown> | null;
}) {
  const capture: Capture = { upserts: [], updates: [], tablesTouched: [] };

  function builder(table: string) {
    capture.tablesTouched.push(table);
    const filters: Record<string, unknown> = {};
    const api: Record<string, unknown> = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return api;
      },
      maybeSingle() {
        if (table === "whatsapp_instance_secrets") {
          return Promise.resolve({ data: opts.secretRow ?? null, error: null });
        }
        if (table === "whatsapp_instances") {
          // Honor the provider='meta_cloud' filter the resolver applies.
          if (filters.provider && opts.instanceRow && opts.instanceRow.provider !== filters.provider) {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: opts.instanceRow ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      upsert(row: Record<string, unknown>, optsArg: Record<string, unknown>) {
        capture.upserts.push({ row, opts: optsArg });
        return Promise.resolve({ error: null });
      },
      update(payload: Record<string, unknown>) {
        const updFilters: Record<string, unknown> = {};
        const updApi: Record<string, unknown> = {
          eq(col: string, val: unknown) {
            updFilters[col] = val;
            return updApi;
          },
          then(resolve: (v: { error: null }) => void) {
            capture.updates.push({ payload, filters: updFilters });
            resolve({ error: null });
          },
        };
        return updApi;
      },
    };
    return api;
  }

  return { supabase: { from: (t: string) => builder(t) } as unknown, capture };
}

const PHONE_NUMBER_ID = "109876543210987";
const WAMID = "wamid.HBgMNTUxMTk5OTk5OTk5FQIAEhggABCDEF==";

function makeProvisioned() {
  return makeSupabase({
    secretRow: { instance_id: "inst-meta-1", organization_id: "org-meta" },
    instanceRow: {
      id: "inst-meta-1",
      organization_id: "org-meta",
      provider: "meta_cloud",
      is_active: true,
    },
  });
}

function inboundEntry(msgOverride: Record<string, unknown> = {}) {
  return {
    id: "WABA_123",
    changes: [
      {
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5511999999999", phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ wa_id: "5511988887777", profile: { name: "Maria Cliente" } }],
          messages: [
            {
              id: WAMID,
              from: "5511988887777",
              timestamp: "1718000000",
              type: "text",
              text: { body: "Olá, quero um orçamento" },
              ...msgOverride,
            },
          ],
        },
      },
    ],
  };
}

beforeEach(() => {
  logRuntime.mockClear();
});

// ---------------------------------------------------------------------------

describe("WA Cloud inbound — provisioned phone_number_id resolution", () => {
  it("resolves org/instance from metadata.phone_number_id and writes whatsapp_messages", async () => {
    const { supabase, capture } = makeProvisioned();

    await processWhatsAppCloudEntry(supabase, inboundEntry());

    expect(capture.upserts).toHaveLength(1);
    const { row } = capture.upserts[0];
    expect(row.organization_id).toBe("org-meta");
    expect(row.instance_id).toBe("inst-meta-1");
    expect(capture.tablesTouched).toContain("whatsapp_instance_secrets");
    expect(capture.tablesTouched).toContain("whatsapp_messages");
  });

  it("uses the REAL wamid as message_id (status callbacks must hit this row)", async () => {
    const { supabase, capture } = makeProvisioned();

    await processWhatsAppCloudEntry(supabase, inboundEntry());

    expect(capture.upserts[0].row.message_id).toBe(WAMID);
  });

  it("writes the idempotent webhook upsert shape (onConflict + ignoreDuplicates)", async () => {
    const { supabase, capture } = makeProvisioned();

    await processWhatsAppCloudEntry(supabase, inboundEntry());

    expect(capture.upserts[0].opts).toEqual({
      onConflict: "message_id,instance_id",
      ignoreDuplicates: true,
    });
  });

  it("normalizes direction/status/phone/push_name/received_via for the chat", async () => {
    const { supabase, capture } = makeProvisioned();

    await processWhatsAppCloudEntry(supabase, inboundEntry());

    const { row } = capture.upserts[0];
    expect(row.direction).toBe("incoming");
    expect(row.status).toBe("received");
    expect(row.phone_number).toBe("5511988887777");
    expect(row.remote_jid).toBe("5511988887777@s.whatsapp.net");
    expect(row.push_name).toBe("Maria Cliente");
    expect(row.received_via).toBe("webhook");
    expect(row.message_type).toBe("text");
    expect(row.content).toBe("Olá, quero um orçamento");
  });
});

describe("WA Cloud inbound — unprovisioned binding rejected (Rule 11)", () => {
  it("drops inbound with no matching secrets row — no whatsapp_messages write", async () => {
    const { supabase, capture } = makeSupabase({ secretRow: null, instanceRow: null });

    await processWhatsAppCloudEntry(supabase, inboundEntry());

    expect(capture.upserts).toHaveLength(0);
    expect(capture.tablesTouched).not.toContain("whatsapp_messages");
    expect(logRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ action: "meta_cloud_unprovisioned_phone_number_id" }),
    );
  });

  it("drops inbound when the secrets row points at a non-meta_cloud instance", async () => {
    const { supabase, capture } = makeSupabase({
      secretRow: { instance_id: "inst-uazapi", organization_id: "org-x" },
      instanceRow: { id: "inst-uazapi", organization_id: "org-x", provider: "uazapi", is_active: true },
    });

    await processWhatsAppCloudEntry(supabase, inboundEntry());

    expect(capture.upserts).toHaveLength(0);
  });

  it("drops inbound when the resolved instance is inactive", async () => {
    const { supabase, capture } = makeSupabase({
      secretRow: { instance_id: "inst-meta-1", organization_id: "org-meta" },
      instanceRow: { id: "inst-meta-1", organization_id: "org-meta", provider: "meta_cloud", is_active: false },
    });

    await processWhatsAppCloudEntry(supabase, inboundEntry());

    expect(capture.upserts).toHaveLength(0);
  });
});

describe("WA Cloud status callbacks — update by wamid", () => {
  it("updates whatsapp_messages.status by wamid for delivered/read/failed", async () => {
    const { supabase, capture } = makeProvisioned();

    const entry = {
      id: "WABA_123",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            statuses: [
              { id: WAMID, status: "delivered", recipient_id: "5511988887777" },
              { id: "wamid.OTHER", status: "read", recipient_id: "5511988887777" },
            ],
          },
        },
      ],
    };

    await processWhatsAppCloudEntry(supabase, entry);

    expect(capture.updates).toHaveLength(2);
    expect(capture.updates[0]).toEqual({
      payload: { status: "delivered" },
      filters: { message_id: WAMID, instance_id: "inst-meta-1" },
    });
    expect(capture.updates[1].payload).toEqual({ status: "read" });
  });

  it("ignores unknown status values (no update)", async () => {
    const { supabase, capture } = makeProvisioned();

    const entry = {
      id: "WABA_123",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            statuses: [{ id: WAMID, status: "warbled", recipient_id: "x" }],
          },
        },
      ],
    };

    await processWhatsAppCloudEntry(supabase, entry);

    expect(capture.updates).toHaveLength(0);
  });
});

describe("WA Cloud media — store Cloud media_id, defer download", () => {
  it("image: stores media_id in media_url, caption in content, maps type", async () => {
    const { supabase, capture } = makeProvisioned();

    await processWhatsAppCloudEntry(
      supabase,
      inboundEntry({
        type: "image",
        text: undefined,
        image: { id: "MEDIA_ID_999", caption: "veja isso", mime_type: "image/jpeg" },
      }),
    );

    const { row } = capture.upserts[0];
    expect(row.message_type).toBe("image");
    expect(row.media_url).toBe("MEDIA_ID_999");
    expect(row.content).toBe("veja isso");
  });

  it("voice maps to ptt and stores the media_id", () => {
    const n = normalizeCloudMessage(
      { id: "w1", from: "551199", timestamp: "1718000000", type: "voice", voice: { id: "AUDIO_1" } },
      null,
    );
    expect(n.message_type).toBe("ptt");
    expect(n.media_url).toBe("AUDIO_1");
    expect(n.content).toBeNull();
  });

  it("interactive button reply lifts the selected title into content", () => {
    const n = normalizeCloudMessage(
      {
        id: "w2",
        from: "551199",
        timestamp: "1718000000",
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: "opt_a", title: "Sim, quero" } },
      },
      null,
    );
    expect(n.message_type).toBe("buttonResponse");
    expect(n.content).toBe("Sim, quero");
  });

  it("converts epoch-seconds timestamp to ISO", () => {
    const n = normalizeCloudMessage(
      { id: "w3", from: "551199", timestamp: "1718000000", type: "text", text: { body: "hi" } },
      null,
    );
    expect(n.timestamp).toBe(new Date(1718000000 * 1000).toISOString());
  });
});

describe("WA Cloud branch isolation", () => {
  it("only processes field==='messages' changes (ignores e.g. account_update)", async () => {
    const { supabase, capture } = makeProvisioned();

    const entry = {
      id: "WABA_123",
      changes: [
        {
          field: "account_update",
          value: { metadata: { phone_number_id: PHONE_NUMBER_ID } },
        },
      ],
    };

    await processWhatsAppCloudEntry(supabase, entry);

    expect(capture.upserts).toHaveLength(0);
    expect(capture.updates).toHaveLength(0);
    expect(capture.tablesTouched).not.toContain("whatsapp_instance_secrets");
  });

  it("never writes channel_messages (the Messenger/IG table) for WA Cloud", async () => {
    const { supabase, capture } = makeProvisioned();

    await processWhatsAppCloudEntry(supabase, inboundEntry());

    expect(capture.tablesTouched).not.toContain("channel_messages");
  });
});
