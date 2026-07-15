/**
 * Tests for the pure ERP-provider resolver (S6, ADR-0020). The capability
 * manifest drives which Carteira/Integrations surfaces render per org. The
 * resolver is pure (no React) so it is exhaustively unit-tested here.
 */
import { describe, it, expect } from "vitest";
import {
  resolveErpProvider,
  TINY_CAPABILITIES,
  OMIE_CAPABILITIES,
} from "../../src/modules/integrations/lib/erp-provider";

const tinyOn = {
  connected: true as const,
  account_name: "Minha Loja Tiny",
  connected_at: "2026-07-15T00:00:00Z",
  last_error: null,
};
const tinyOff = { connected: false as const, account_name: null, connected_at: null, last_error: null };

const omieOn = (mode: "off" | "enrich_only" | "canonical") => ({
  connected: true as const,
  account_name: "Omie",
  connected_at: "2026-07-15T00:00:00Z",
  erp_sync_mode: mode,
  last_error: null,
});
const omieOff = {
  connected: false as const,
  account_name: null,
  connected_at: null,
  erp_sync_mode: "enrich_only" as const,
  last_error: null,
};

describe("resolveErpProvider", () => {
  it("resolves to no provider when neither is connected", () => {
    const r = resolveErpProvider(tinyOff, omieOff);
    expect(r.provider).toBeNull();
    expect(r.providerId).toBeNull();
    expect(r.bothConnected).toBe(false);
    expect(r.can("pushOrder")).toBe(false);
  });

  it("resolves Tiny when only Tiny is connected", () => {
    const r = resolveErpProvider(tinyOn, omieOff);
    expect(r.providerId).toBe("tiny");
    expect(r.provider?.label).toBe("TinyERP");
    expect(r.provider?.accountName).toBe("Minha Loja Tiny");
    expect(r.can("pushOrder")).toBe(true);
    expect(r.can("syncProducts")).toBe(true);
    expect(r.can("fetchNfe")).toBe(true);
    expect(r.can("syncClientes")).toBe(false);
    expect(r.can("syncPedidos")).toBe(false);
    expect(r.can("receivables")).toBe(false);
    expect(r.can("canonicalMode")).toBe(false);
    expect(r.provider?.syncMode).toBeNull();
  });

  it("resolves Omie (enrich_only) when only Omie is connected", () => {
    const r = resolveErpProvider(tinyOff, omieOn("enrich_only"));
    expect(r.providerId).toBe("omie");
    expect(r.can("syncClientes")).toBe(true);
    expect(r.can("syncPedidos")).toBe(true);
    expect(r.can("pushOrder")).toBe(false);
    expect(r.can("fetchNfe")).toBe(false);
    expect(r.can("receivables")).toBe(false);
    expect(r.can("canonicalMode")).toBe(false);
  });

  it("derives canonicalMode from Omie's canonical sync mode", () => {
    const r = resolveErpProvider(tinyOff, omieOn("canonical"));
    expect(r.can("canonicalMode")).toBe(true);
    expect(r.provider?.syncMode).toBe("canonical");
  });

  it("prefers Omie deterministically when both are connected, flagging the misconfig", () => {
    const r = resolveErpProvider(tinyOn, omieOn("enrich_only"));
    expect(r.bothConnected).toBe(true);
    expect(r.providerId).toBe("omie");
    expect(r.can("syncClientes")).toBe(true);
  });

  it("can() returns false for every capability when there is no provider", () => {
    const r = resolveErpProvider(tinyOff, omieOff);
    for (const cap of Object.keys(OMIE_CAPABILITIES) as Array<keyof typeof OMIE_CAPABILITIES>) {
      expect(r.can(cap)).toBe(false);
    }
  });

  it("manifest invariant: Omie cannot push and Tiny cannot user-sync clientes today", () => {
    // Freezes the grounded truth so a future edit that lies trips the test.
    expect(OMIE_CAPABILITIES.pushOrder).toBe(false);
    expect(OMIE_CAPABILITIES.syncClientes).toBe(true);
    expect(TINY_CAPABILITIES.pushOrder).toBe(true);
    expect(TINY_CAPABILITIES.syncClientes).toBe(false);
  });
});
