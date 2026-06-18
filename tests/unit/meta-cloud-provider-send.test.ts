/**
 * MetaCloudProvider — outbound send (Track B final).
 *
 * Pins the acceptance criteria of the send slice:
 *  1. open window  → sendText returns the REAL wamid (no double-write here — D4).
 *  2. closed window → sendText/sendMedia throw MetaWindowClosedError (NOT
 *     NotSupportedError, NOT a raw 500).
 *  3. sendTemplate ignores the window and returns the wamid.
 *  4. sendMedia: http URL → link; base64 → upload→id; type mapped + caption/
 *     filename gated per type.
 *  5. credentials via get_meta_cloud_credentials; missing token/error → throw
 *     fail-closed; token NEVER logged.
 *  6. setPresence is a no-op; getStatus + downloadMedia work.
 *
 * No network, no DB — the credential RPC, the window read, and the Graph client
 * are all injected/mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Deno polyfill (mirrors meta-cloud-isolation.test.ts) — provider has no env use,
// but the import chain references Deno transitively in sibling modules.
if (typeof globalThis.Deno === "undefined") {
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: () => undefined },
    serve: () => {},
  };
}

import {
  MetaCloudProvider,
  decodeBase64Media,
  encodeBase64,
} from "../../supabase/functions/_shared/whatsapp-providers/meta-cloud-provider.ts";
import { MetaWindowClosedError, NotSupportedError } from "../../supabase/functions/_shared/whatsapp-client.ts";

const INSTANCE = "inst-meta";
const ORG = "org-a";
const TOKEN = "SECRET-TOKEN-abc";
const PNID = "999000111";

/** supabaseAdmin mock: get_meta_cloud_credentials RPC + whatsapp_messages window read. */
function makeAdmin(opts: {
  creds?: { meta_access_token: string | null; meta_phone_number_id: string | null; meta_waba_id?: string | null; organization_id?: string } | null;
  credsError?: { message: string } | null;
  lastInbound?: string | null;
} = {}) {
  const creds =
    opts.creds === undefined
      ? { meta_access_token: TOKEN, meta_phone_number_id: PNID, meta_waba_id: "WABA-1", organization_id: ORG }
      : opts.creds;
  const rpc = vi.fn(async (name: string) => {
    if (name === "get_meta_cloud_credentials") {
      return { data: creds ? [creds] : [], error: opts.credsError ?? null };
    }
    return { data: null, error: null };
  });

  const windowRow = opts.lastInbound === undefined ? { timestamp: new Date().toISOString() } : opts.lastInbound ? { timestamp: opts.lastInbound } : null;
  const windowEq: Record<string, unknown> = {};
  const from = vi.fn(() => {
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        windowEq[col] = val;
        return api;
      },
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: windowRow, error: null }),
    };
    return api;
  });

  return Object.assign({ rpc, from }, { __windowEq: windowEq }) as never;
}

/** A spyable Graph client + a factory that returns it. */
function makeGraphFactory(overrides: Record<string, unknown> = {}) {
  const client = {
    sendText: vi.fn(async () => ({ wamid: "wamid.TEXT" })),
    sendMediaByLink: vi.fn(async () => ({ wamid: "wamid.LINK" })),
    sendMediaById: vi.fn(async () => ({ wamid: "wamid.ID" })),
    sendTemplate: vi.fn(async () => ({ wamid: "wamid.TPL" })),
    uploadMedia: vi.fn(async () => "MEDIA-UP"),
    getMedia: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" })),
    getPhoneNumber: vi.fn(async () => ({ display_phone_number: "+55 11 90000-0000", verified_name: "Loja" })),
    ...overrides,
  };
  const factory = vi.fn(() => client);
  return { client, factory: factory as never };
}

function makeProvider(admin: never, factory: never) {
  return new MetaCloudProvider({
    instanceId: INSTANCE,
    organizationId: ORG,
    supabaseAdmin: admin,
    graphFactory: factory,
  });
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("MetaCloudProvider.sendText — open window", () => {
  it("returns the real wamid and passes digit-only `to` to the Graph", async () => {
    const admin = makeAdmin({ lastInbound: new Date().toISOString() });
    const { client, factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);

    const res = await provider.sendText({ number: "+55 (11) 99999-8888", text: "oi" });

    expect(res).toEqual({ message_id: "wamid.TEXT", status: "sent", timestamp: expect.any(Number) });
    expect(client.sendText).toHaveBeenCalledWith("5511999998888", "oi");
    // Graph built with the resolved token + phone_number_id.
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, phoneNumberId: PNID }));
    // The window lookup uses bare digits — the SAME form Cloud inbound stores in
    // whatsapp_messages.phone_number, so a formatted composer input still matches.
    expect((admin as unknown as { __windowEq: Record<string, unknown> }).__windowEq.phone_number).toBe("5511999998888");
  });

  it("resolves credentials only once across two sends (memoized)", async () => {
    const admin = makeAdmin({ lastInbound: new Date().toISOString() });
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);

    await provider.sendText({ number: "5511999998888", text: "a" });
    await provider.sendText({ number: "5511999998888", text: "b" });

    expect((admin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledTimes(1);
  });
});

describe("MetaCloudProvider.sendText — closed window", () => {
  it("throws MetaWindowClosedError (NOT NotSupportedError) when no recent inbound", async () => {
    const admin = makeAdmin({ lastInbound: null });
    const { client, factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);

    const err = await provider.sendText({ number: "5511999998888", text: "oi" }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaWindowClosedError);
    expect(err).not.toBeInstanceOf(NotSupportedError);
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("throws MetaWindowClosedError when last inbound is older than 24h", async () => {
    const old = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    const admin = makeAdmin({ lastInbound: old });
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);

    await expect(provider.sendText({ number: "5511999998888", text: "oi" })).rejects.toBeInstanceOf(
      MetaWindowClosedError,
    );
  });
});

describe("MetaCloudProvider.sendMedia", () => {
  it("URL file → sends by link with caption (image)", async () => {
    const admin = makeAdmin({ lastInbound: new Date().toISOString() });
    const { client, factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);

    const res = await provider.sendMedia({
      number: "5511999998888",
      type: "image",
      file: "https://cdn/x.jpg",
      caption: "legenda",
    });

    expect(res.message_id).toBe("wamid.LINK");
    expect(client.sendMediaByLink).toHaveBeenCalledWith("5511999998888", "image", {
      link: "https://cdn/x.jpg",
      caption: "legenda",
      filename: undefined,
    });
    expect(client.uploadMedia).not.toHaveBeenCalled();
  });

  it("base64 file → uploads then sends by id (document keeps filename)", async () => {
    const admin = makeAdmin({ lastInbound: new Date().toISOString() });
    const { client, factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);

    const b64 = "data:application/pdf;base64," + encodeBase64(new Uint8Array([1, 2, 3]));
    const res = await provider.sendMedia({
      number: "5511999998888",
      type: "document",
      file: b64,
      filename: "contrato.pdf",
      caption: "doc",
    });

    expect(res.message_id).toBe("wamid.ID");
    expect(client.uploadMedia).toHaveBeenCalledTimes(1);
    expect(client.sendMediaById).toHaveBeenCalledWith("5511999998888", "document", {
      id: "MEDIA-UP",
      caption: "doc",
      filename: "contrato.pdf",
    });
  });

  it("maps ptt → audio and drops caption/filename for audio", async () => {
    const admin = makeAdmin({ lastInbound: new Date().toISOString() });
    const { client, factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);

    await provider.sendMedia({
      number: "5511999998888",
      type: "ptt",
      file: "https://cdn/a.ogg",
      caption: "ignored",
      filename: "ignored.ogg",
    });

    expect(client.sendMediaByLink).toHaveBeenCalledWith("5511999998888", "audio", {
      link: "https://cdn/a.ogg",
      caption: undefined,
      filename: undefined,
    });
  });

  it("throws MetaWindowClosedError when the window is closed", async () => {
    const admin = makeAdmin({ lastInbound: null });
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);

    await expect(
      provider.sendMedia({ number: "5511999998888", type: "image", file: "https://cdn/x.jpg" }),
    ).rejects.toBeInstanceOf(MetaWindowClosedError);
  });
});

describe("MetaCloudProvider.sendTemplate", () => {
  it("ignores the window and returns the wamid", async () => {
    // last inbound is null → window CLOSED, but template must still send.
    const admin = makeAdmin({ lastInbound: null });
    const { client, factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);

    const res = await provider.sendTemplate({
      number: "+55 11 99999-8888",
      templateName: "boas_vindas",
      language: "pt_BR",
      components: [{ type: "body" }],
    });

    expect(res.message_id).toBe("wamid.TPL");
    expect(client.sendTemplate).toHaveBeenCalledWith("5511999998888", {
      name: "boas_vindas",
      language: { code: "pt_BR" },
      components: [{ type: "body" }],
    });
  });
});

describe("MetaCloudProvider — credentials fail-closed (Rule 9)", () => {
  it("throws when the RPC errors", async () => {
    const admin = makeAdmin({ credsError: { message: "permission denied" } });
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);
    await expect(provider.sendText({ number: "55119", text: "x" })).rejects.toThrow(/credentials/i);
  });

  it("throws when the access token is null", async () => {
    const admin = makeAdmin({ creds: { meta_access_token: null, meta_phone_number_id: PNID } });
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);
    await expect(provider.sendText({ number: "55119", text: "x" })).rejects.toThrow(/access_token/i);
  });

  it("throws when no credential row exists", async () => {
    const admin = makeAdmin({ creds: null });
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);
    await expect(provider.sendText({ number: "55119", text: "x" })).rejects.toThrow(/No meta_cloud credentials/i);
  });

  it("never logs the access token", async () => {
    const admin = makeAdmin({ lastInbound: new Date().toISOString() });
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);
    await provider.sendText({ number: "5511999998888", text: "oi" });

    const allLogs = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().join(" ");
    expect(allLogs).not.toContain(TOKEN);
  });
});

describe("MetaCloudProvider — setPresence / getStatus / downloadMedia (D6)", () => {
  it("setPresence is a no-op and never throws", async () => {
    const admin = makeAdmin();
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);
    await expect(provider.setPresence("5511999998888", "composing")).resolves.toBeUndefined();
  });

  it("getStatus returns connected + owner digits", async () => {
    const admin = makeAdmin();
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);
    const status = await provider.getStatus();
    expect(status).toEqual({ connected: true, state: "connected", owner: "5511900000000" });
  });

  it("getStatus degrades to unknown when the phone node is null (never throws)", async () => {
    const admin = makeAdmin();
    const { factory } = makeGraphFactory({ getPhoneNumber: vi.fn(async () => null) });
    const provider = makeProvider(admin, factory);
    const status = await provider.getStatus();
    expect(status).toEqual({ connected: false, state: "unknown" });
  });

  it("getStatus degrades to disconnected when credentials are missing (never throws)", async () => {
    const admin = makeAdmin({ creds: null });
    const { factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);
    const status = await provider.getStatus();
    expect(status).toEqual({ connected: false, state: "disconnected" });
  });

  it("downloadMedia returns base64 + mimetype", async () => {
    const admin = makeAdmin();
    const { client, factory } = makeGraphFactory();
    const provider = makeProvider(admin, factory);
    const out = await provider.downloadMedia("MID-1");
    expect(client.getMedia).toHaveBeenCalledWith("MID-1");
    expect(out.mimetype).toBe("image/png");
    expect(out.base64).toBe(encodeBase64(new Uint8Array([1, 2, 3])));
  });
});

describe("base64 helpers", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const { bytes: out } = decodeBase64Media(encodeBase64(bytes));
    expect(Array.from(out)).toEqual([0, 1, 2, 250, 255]);
  });

  it("parses a data: URL mime", () => {
    const { mimeType } = decodeBase64Media("data:image/jpeg;base64," + encodeBase64(new Uint8Array([1])));
    expect(mimeType).toBe("image/jpeg");
  });

  it("defaults mime to octet-stream for raw base64", () => {
    const { mimeType } = decodeBase64Media(encodeBase64(new Uint8Array([1])));
    expect(mimeType).toBe("application/octet-stream");
  });
});

describe("MetaCloudProvider — capability gating still holds (Rule 7 regression)", () => {
  const provider = new MetaCloudProvider({ instanceId: "i", organizationId: ORG, supabaseAdmin: {} as never });
  const uazapiOnly: Array<[string, () => unknown]> = [
    ["sendMenu", () => provider.sendMenu!()],
    ["sendPixButton", () => provider.sendPixButton!()],
    ["react", () => provider.react!("m", "n", "x")],
    ["historySync", () => provider.historySync!({})],
    ["senderAdvanced", () => provider.senderAdvanced!({} as never)],
    ["createInstance", () => provider.createInstance({} as never)],
    ["connectQR", () => provider.connectQR()],
  ];
  it.each(uazapiOnly)("%s still throws 'does not support'", (_n, call) => {
    expect(call).toThrow(/does not support/);
  });
});
