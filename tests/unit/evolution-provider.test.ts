/**
 * Unit tests for EvolutionProvider — focused on NotSupportedError behaviour
 *
 * EvolutionProvider implements the WhatsAppProvider interface but throws
 * NotSupportedError for all Uazapi-only operations. This suite verifies
 * each Uazapi-only method throws NotSupportedError with the correct shape,
 * and that core Evolution methods do NOT throw that error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Polyfill Deno for Node/Vitest
// ---------------------------------------------------------------------------

const envStore: Record<string, string> = {
  EVOLUTION_API_URL: "https://evolution.test",
  EVOLUTION_API_KEY: "evo-key-abc",
};

if (typeof globalThis.Deno === "undefined") {
  (globalThis as Record<string, unknown>).Deno = {
    env: {
      get: (key: string) => envStore[key] ?? undefined,
    },
    serve: () => {},
  };
}

import {
  EvolutionProvider,
} from "../../supabase/functions/_shared/whatsapp-providers/evolution-provider.ts";
import {
  NotSupportedError,
  type WhatsAppInstance,
} from "../../supabase/functions/_shared/whatsapp-client.ts";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const EVOLUTION_INSTANCE: WhatsAppInstance = {
  id: "inst-evo-uuid",
  organization_id: "org-a",
  provider: "evolution",
  instance_name: "my-evo-instance",
  evolution_api_key: "evo-key",
  evolution_instance_name: "my-evo-instance",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// NotSupportedError on Uazapi-only methods
// ---------------------------------------------------------------------------

describe("EvolutionProvider — NotSupportedError on Uazapi-only methods", () => {
  const provider = new EvolutionProvider(EVOLUTION_INSTANCE);

  it("sendMenu throws NotSupportedError", () => {
    expect(() =>
      provider.sendMenu!({
        number: "5511999999999",
        type: "button",
        text: "hi",
        choices: ["a", "b"],
      })
    ).toThrow(NotSupportedError);
  });

  it("sendMenu error.provider === 'evolution'", () => {
    let caught: NotSupportedError | undefined;
    try {
      provider.sendMenu!({ number: "5511999999999", type: "button", text: "hi", choices: [] });
    } catch (e) {
      caught = e as NotSupportedError;
    }
    expect(caught?.provider).toBe("evolution");
    expect(caught?.method).toBe("sendMenu");
  });

  it("sendPixButton throws NotSupportedError", () => {
    expect(() =>
      provider.sendPixButton!({
        number: "5511999999999",
        pixkey: "11122233344",
        pixkeyType: "cpf",
        amount: 49.9,
        merchantName: "Loja",
      })
    ).toThrow(NotSupportedError);
  });

  it("sendPixButton error.method === 'sendPixButton'", () => {
    let caught: NotSupportedError | undefined;
    try {
      provider.sendPixButton!({
        number: "5511999999999",
        pixkey: "key",
        pixkeyType: "cpf",
        amount: 1,
        merchantName: "Test",
      });
    } catch (e) {
      caught = e as NotSupportedError;
    }
    expect(caught?.method).toBe("sendPixButton");
  });

  it("react throws NotSupportedError", () => {
    expect(() =>
      provider.react!("msg-id", "5511999999999", "👍")
    ).toThrow(NotSupportedError);
  });

  it("react error.method === 'react'", () => {
    let caught: NotSupportedError | undefined;
    try { provider.react!("id", "num", "emoji"); } catch (e) { caught = e as NotSupportedError; }
    expect(caught?.method).toBe("react");
    expect(caught?.provider).toBe("evolution");
  });

  it("edit throws NotSupportedError", () => {
    expect(() =>
      provider.edit!("msg-id", "5511999999999", "new text")
    ).toThrow(NotSupportedError);
  });

  it("edit error.method === 'edit'", () => {
    let caught: NotSupportedError | undefined;
    try { provider.edit!("id", "num", "text"); } catch (e) { caught = e as NotSupportedError; }
    expect(caught?.method).toBe("edit");
  });

  it("pin throws NotSupportedError", () => {
    expect(() =>
      provider.pin!("msg-id", "5511999999999")
    ).toThrow(NotSupportedError);
  });

  it("pin error.method === 'pin'", () => {
    let caught: NotSupportedError | undefined;
    try { provider.pin!("id", "num"); } catch (e) { caught = e as NotSupportedError; }
    expect(caught?.method).toBe("pin");
  });

  it("deleteForAll throws NotSupportedError", () => {
    expect(() =>
      provider.deleteForAll!("msg-id", "5511999999999")
    ).toThrow(NotSupportedError);
  });

  it("deleteForAll error.method === 'deleteForAll'", () => {
    let caught: NotSupportedError | undefined;
    try { provider.deleteForAll!("id", "num"); } catch (e) { caught = e as NotSupportedError; }
    expect(caught?.method).toBe("deleteForAll");
  });

  it("markRead throws NotSupportedError", () => {
    expect(() =>
      provider.markRead!("msg-id", "5511999999999")
    ).toThrow(NotSupportedError);
  });

  it("markRead error.method === 'markRead'", () => {
    let caught: NotSupportedError | undefined;
    try { provider.markRead!("id", "num"); } catch (e) { caught = e as NotSupportedError; }
    expect(caught?.method).toBe("markRead");
  });

  it("historySync throws NotSupportedError", () => {
    expect(() =>
      provider.historySync!({})
    ).toThrow(NotSupportedError);
  });

  it("historySync error.method === 'historySync'", () => {
    let caught: NotSupportedError | undefined;
    try { provider.historySync!({}); } catch (e) { caught = e as NotSupportedError; }
    expect(caught?.method).toBe("historySync");
    expect(caught?.provider).toBe("evolution");
  });
});

// ---------------------------------------------------------------------------
// NotSupportedError shape
// ---------------------------------------------------------------------------

describe("NotSupportedError shape from EvolutionProvider", () => {
  it("is instanceof Error", () => {
    let caught: unknown;
    try {
      const p = new EvolutionProvider(EVOLUTION_INSTANCE);
      p.react!("id", "num", "emoji");
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
  });

  it("name === 'NotSupportedError'", () => {
    let caught: NotSupportedError | undefined;
    try {
      const p = new EvolutionProvider(EVOLUTION_INSTANCE);
      p.pin!("id", "num");
    } catch (e) { caught = e as NotSupportedError; }
    expect(caught?.name).toBe("NotSupportedError");
  });

  it("message contains provider and method name", () => {
    let caught: NotSupportedError | undefined;
    try {
      const p = new EvolutionProvider(EVOLUTION_INSTANCE);
      p.edit!("id", "num", "text");
    } catch (e) { caught = e as NotSupportedError; }
    expect(caught?.message).toContain("evolution");
    expect(caught?.message).toContain("edit");
  });
});

// ---------------------------------------------------------------------------
// Core Evolution methods — should NOT throw NotSupportedError
// (They will call fetch, which is mocked to fail with network error,
//  but they must not throw NotSupportedError itself.)
// ---------------------------------------------------------------------------

describe("EvolutionProvider — core methods do not throw NotSupportedError", () => {
  it("sendText does not throw NotSupportedError (may throw network error)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));

    const provider = new EvolutionProvider(EVOLUTION_INSTANCE);
    let notSupportedThrown = false;
    try {
      await provider.sendText({ number: "5511999999999", text: "Hi" });
    } catch (e) {
      if (e instanceof NotSupportedError) notSupportedThrown = true;
    }
    expect(notSupportedThrown).toBe(false);
  });

  it("sendMedia does not throw NotSupportedError (may throw network error)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));

    const provider = new EvolutionProvider(EVOLUTION_INSTANCE);
    let notSupportedThrown = false;
    try {
      await provider.sendMedia({ number: "5511999999999", type: "image", file: "url" });
    } catch (e) {
      if (e instanceof NotSupportedError) notSupportedThrown = true;
    }
    expect(notSupportedThrown).toBe(false);
  });
});
