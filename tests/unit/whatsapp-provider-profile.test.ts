/**
 * Provider profile — drives the provider-aware connections UI (chips, capability
 * gating, connect kind). Pure, so it's the testable heart of slice 3/7.
 *
 * Capability gating is a POSITIVE allowlist (cert Rule 13): Uazapi-only actions
 * render only when the instance is uazapi (or legacy/unset = assume uazapi),
 * NEVER `!== 'meta_cloud'`.
 */
import { describe, it, expect } from "vitest";
import {
  getProviderProfile,
  canUseUazapiActions,
} from "../../src/modules/communication/lib/whatsapp-provider";

describe("getProviderProfile", () => {
  it("uazapi = full toolset, QR connect, non-official", () => {
    const p = getProviderProfile("uazapi");
    expect(p.label).toBe("Uazapi");
    expect(p.connectKind).toBe("qr");
    expect(p.official).toBe(false);
    expect(p.capabilities).toMatchObject({
      text: true, media: true, menu: true, pix: true, reactions: true,
      historySync: true, massSend: true, templates: false, window24h: false,
    });
  });

  it("meta_cloud = official, Embedded Signup, templates + 24h window, NO uazapi-only features", () => {
    const p = getProviderProfile("meta_cloud");
    expect(p.label).toBe("Meta Oficial");
    expect(p.connectKind).toBe("embedded_signup");
    expect(p.official).toBe(true);
    expect(p.capabilities).toMatchObject({
      text: true, media: true, templates: true, window24h: true,
      menu: false, pix: false, reactions: false, historySync: false, massSend: false,
    });
  });

  it("evolution = legacy core only (text/media), QR, non-official", () => {
    const p = getProviderProfile("evolution");
    expect(p.connectKind).toBe("qr");
    expect(p.capabilities).toMatchObject({
      text: true, media: true,
      menu: false, pix: false, templates: false, window24h: false, massSend: false,
    });
  });

  it("null/unknown falls back to the uazapi (legacy) profile — never crashes", () => {
    expect(getProviderProfile(null).id).toBe("uazapi");
    expect(getProviderProfile(undefined).id).toBe("uazapi");
    expect(getProviderProfile("something_new").id).toBe("uazapi");
  });
});

describe("canUseUazapiActions (positive allowlist, Rule 13)", () => {
  it("true for uazapi and for null/unset (legacy instances)", () => {
    expect(canUseUazapiActions("uazapi")).toBe(true);
    expect(canUseUazapiActions(null)).toBe(true);
    expect(canUseUazapiActions(undefined)).toBe(true);
  });

  it("false for meta_cloud and evolution (do not render Uazapi-only actions)", () => {
    expect(canUseUazapiActions("meta_cloud")).toBe(false);
    expect(canUseUazapiActions("evolution")).toBe(false);
  });

  it("never uses a negative !== meta_cloud check (unknown provider is NOT treated as uazapi-capable)", () => {
    expect(canUseUazapiActions("carrier_pigeon")).toBe(false);
  });
});
