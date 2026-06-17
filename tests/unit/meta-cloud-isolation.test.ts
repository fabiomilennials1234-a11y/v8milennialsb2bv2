/**
 * Slice 1 — Meta Cloud isolation contract.
 *
 * These tests pin the rules that keep the existing Uazapi/Evolution behavior
 * byte-for-byte identical once `provider='meta_cloud'` rows become insertable.
 * They are the regression anchor for the certification in
 * docs/meta-cloud-cert/CERTIFICATION.md (rules 1–6).
 *
 * No network. Deno is polyfilled for the Node/Vitest environment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Polyfill Deno global (mirrors whatsapp-adapter.test.ts)
// ---------------------------------------------------------------------------

const envStore: Record<string, string> = {
  UAZAPI_BASE_URL: "https://uazapi.example.com",
  UAZAPI_ADMIN_TOKEN: "admin-secret",
};

if (typeof globalThis.Deno === "undefined") {
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (key: string) => envStore[key] ?? undefined },
    serve: () => {},
  };
}

import {
  resolveInstance,
} from "../../supabase/functions/_shared/whatsapp-dispatch.ts";
import {
  getWhatsAppProvider,
  type WhatsAppInstance,
} from "../../supabase/functions/_shared/whatsapp-client.ts";
import { MetaCloudProvider } from "../../supabase/functions/_shared/whatsapp-providers/meta-cloud-provider.ts";

// ---------------------------------------------------------------------------
// Faithful query-builder mock: applies eq/in/order/limit to an in-memory set.
// Tests OBSERVABLE behavior (which instance is returned), not which filter was
// called — so the test survives a refactor of HOW meta_cloud is excluded.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeQueryAdmin(rows: Row[]) {
  function builder() {
    let filtered = [...rows];
    const api: Record<string, unknown> = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filtered = filtered.filter((r) => vals.includes(r[col]));
        return api;
      },
      order(col: string, opts: { ascending?: boolean } = {}) {
        const asc = opts.ascending !== false;
        filtered.sort((a, b) => {
          const av = a[col] as string;
          const bv = b[col] as string;
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (asc ? 1 : -1);
        });
        return api;
      },
      limit(n: number) {
        filtered = filtered.slice(0, n);
        return api;
      },
      maybeSingle() {
        return Promise.resolve({ data: filtered[0] ?? null, error: null });
      },
    };
    return api;
  }
  return { from: () => builder() };
}

const ORG = "org-a";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Meta Cloud isolation — resolveInstance legacy fallback (Rule 1)", () => {
  it("in a mixed org, the provider-blind fallback never resolves a meta_cloud instance", async () => {
    // Meta instance is OLDER, so created_at-ASC ordering would pick it pre-fix.
    const rows: Row[] = [
      { id: "meta-older", organization_id: ORG, provider: "meta_cloud", status: "connected", created_at: "2024-01-01T00:00:00Z" },
      { id: "uazapi-newer", organization_id: ORG, provider: "uazapi", status: "connected", created_at: "2025-01-01T00:00:00Z" },
    ];
    const admin = makeQueryAdmin(rows) as never;

    const inst = await resolveInstance(admin, ORG, { requireConnected: true });

    // A Uazapi-intended auto-dispatch must land on the Uazapi number, never Meta.
    expect(inst?.provider).toBe("uazapi");
    expect(inst?.id).toBe("uazapi-newer");
  });

  it("in a meta-only org, the legacy fallback returns null instead of mis-routing", async () => {
    const rows: Row[] = [
      { id: "meta-1", organization_id: ORG, provider: "meta_cloud", status: "connected", created_at: "2024-01-01T00:00:00Z" },
    ];
    const admin = makeQueryAdmin(rows) as never;

    const inst = await resolveInstance(admin, ORG, { requireConnected: true });

    // No legacy instance → caller fails cleanly with no_instance, no Meta hijack.
    expect(inst).toBeNull();
  });

  it("a pure Uazapi org is unaffected (legacy behavior preserved byte-for-byte)", async () => {
    const rows: Row[] = [
      { id: "uazapi-1", organization_id: ORG, provider: "uazapi", status: "connected", created_at: "2025-01-01T00:00:00Z" },
    ];
    const admin = makeQueryAdmin(rows) as never;

    const inst = await resolveInstance(admin, ORG, { requireConnected: true });

    expect(inst?.id).toBe("uazapi-1");
  });
});

// ---------------------------------------------------------------------------
// Factory mock: org-override lookup + uazapi-credentials RPC.
// ---------------------------------------------------------------------------

function makeFactoryAdmin(opts: { override?: string | null; rpc?: ReturnType<typeof vi.fn> } = {}) {
  const rpc =
    opts.rpc ??
    vi.fn().mockResolvedValue({ data: [{ uazapi_token: "tok" }], error: null });
  return {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { whatsapp_provider_override: opts.override ?? null },
              error: null,
            }),
        }),
      }),
    }),
  };
}

const META_INSTANCE = {
  id: "inst-meta-uuid",
  organization_id: ORG,
  provider: "meta_cloud",
  instance_name: "my-meta-number",
} as unknown as WhatsAppInstance;

describe("Meta Cloud isolation — getWhatsAppProvider factory (Rules 3,4,5)", () => {
  it("resolves a meta_cloud instance to a meta_cloud provider, never fetching uazapi credentials", async () => {
    const rpc = vi.fn();
    const admin = makeFactoryAdmin({ rpc }) as never;

    const provider = await getWhatsAppProvider(META_INSTANCE, admin);

    expect(provider.provider).toBe("meta_cloud");
    // Must NOT touch the Uazapi credential RPC — isolated credential path.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still throws loudly for a genuinely unknown provider", async () => {
    const admin = makeFactoryAdmin() as never;
    const bogus = { ...META_INSTANCE, provider: "carrier_pigeon" } as unknown as WhatsAppInstance;

    await expect(getWhatsAppProvider(bogus, admin)).rejects.toThrow(/[Uu]nknown provider/);
  });

  it("the org-wide kill-switch override does NOT coerce a meta_cloud instance into Uazapi", async () => {
    // override='uazapi' must only switch between the two LEGACY providers.
    const admin = makeFactoryAdmin({ override: "uazapi" }) as never;

    const provider = await getWhatsAppProvider(META_INSTANCE, admin);

    expect(provider.provider).toBe("meta_cloud");
  });
});

describe("Meta Cloud isolation — capability gating (Rule 7)", () => {
  const provider = new MetaCloudProvider({
    instanceId: "i",
    organizationId: ORG,
    supabaseAdmin: {} as never,
  });

  // Uazapi-only features the frontend gates via isFeatureUnavailable(), which
  // matches the literal "does not support" substring. Meta must mirror Evolution,
  // which throws SYNCHRONOUSLY from these Promise-typed methods.
  const uazapiOnly: Array<[string, () => unknown]> = [
    ["sendMenu", () => provider.sendMenu!()],
    ["sendPixButton", () => provider.sendPixButton!()],
    ["react", () => provider.react!("m", "n", "x")],
    ["edit", () => provider.edit!("m", "n", "t")],
    ["pin", () => provider.pin!("m", "n")],
    ["deleteForAll", () => provider.deleteForAll!("m", "n")],
    ["markRead", () => provider.markRead!("m", "n")],
    ["historySync", () => provider.historySync!({})],
    ["senderAdvanced", () => provider.senderAdvanced!({} as never)],
  ];

  it.each(uazapiOnly)(
    "%s throws NotSupportedError carrying the 'does not support' substring",
    (_name, call) => {
      expect(call).toThrow(/does not support/);
    },
  );

  it("connectQR is unsupported (Meta has no QR — Embedded Signup)", () => {
    expect(() => provider.connectQR()).toThrow(/does not support/);
  });
});
