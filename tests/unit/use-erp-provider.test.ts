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
  TOTH_CAPABILITIES,
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
const tothOn = (mode: "off" | "enrich_only" | "canonical", insecure = false) => ({
  connected: true as const,
  base_url: insecure
    ? "http://cafejurere.ddns.net:8080/toth/services"
    : "https://erp.exemplo.com.br/toth/services",
  connected_at: "2026-08-18T00:00:00Z",
  erp_sync_mode: mode,
  insecure_transport: insecure,
  last_error: null,
});
const tothOff = {
  connected: false as const,
  base_url: null,
  connected_at: null,
  erp_sync_mode: "enrich_only" as const,
  insecure_transport: false,
  last_error: null,
};

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
    expect(r.multipleConnected).toBe(false);
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
    expect(r.multipleConnected).toBe(true);
    expect(r.providerId).toBe("omie");
    expect(r.can("syncClientes")).toBe(true);
  });

  it("can() returns false for every capability when there is no provider", () => {
    const r = resolveErpProvider(tinyOff, omieOff, tothOff);
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

describe("resolveErpProvider — Toth", () => {
  it("resolve o Toth quando só ele está conectado", () => {
    const r = resolveErpProvider(tinyOff, omieOff, tothOn("enrich_only"));
    expect(r.providerId).toBe("toth");
    expect(r.provider?.label).toBe("Toth");
    // O Toth não tem "conta": a identidade da conexão é o endereço do servidor.
    expect(r.provider?.accountName).toBe("https://erp.exemplo.com.br/toth/services");
    expect(r.provider?.syncMode).toBe("enrich_only");
  });

  it("é o primeiro provider com receivables de verdade", () => {
    const r = resolveErpProvider(tinyOff, omieOff, tothOn("enrich_only"));
    expect(r.can("receivables")).toBe(true);
    expect(r.can("syncClientes")).toBe(true);
    // Ausência de endpoint no ERP do cliente, não decisão nossa.
    expect(r.can("syncPedidos")).toBe(false);
    expect(r.can("fetchNfe")).toBe(false);
    expect(r.can("syncProducts")).toBe(false);
    expect(r.can("pushOrder")).toBe(false);
  });

  it("deriva canonicalMode do modo de sincronização, como o Omie", () => {
    expect(resolveErpProvider(tinyOff, omieOff, tothOn("canonical")).can("canonicalMode")).toBe(
      true,
    );
    expect(resolveErpProvider(tinyOff, omieOff, tothOn("off")).can("canonicalMode")).toBe(false);
  });

  it("propaga a falta de TLS para fora da tela de conexão", () => {
    // Qualquer superfície que mostre dado do ERP pode avisar, não só a tela
    // onde a conexão foi configurada.
    expect(resolveErpProvider(tinyOff, omieOff, tothOn("enrich_only", true)).provider
      ?.insecureTransport).toBe(true);
    expect(resolveErpProvider(tinyOff, omieOff, tothOn("enrich_only")).provider
      ?.insecureTransport).toBe(false);
  });

  it("SaaS nunca é marcado como sem criptografia", () => {
    expect(resolveErpProvider(tinyOff, omieOn("enrich_only")).provider?.insecureTransport).toBe(
      false,
    );
    expect(resolveErpProvider(tinyOn, omieOff).provider?.insecureTransport).toBe(false);
  });

  it("Omie ganha do Toth no desempate, e o conflito é sinalizado", () => {
    // A prioridade NÃO segue quem tem o manifesto mais rico — se seguisse,
    // conectar um segundo ERP viraria atalho para ganhar capacidade.
    const r = resolveErpProvider(tinyOff, omieOn("enrich_only"), tothOn("enrich_only"));
    expect(r.providerId).toBe("omie");
    expect(r.multipleConnected).toBe(true);
    expect(r.can("receivables")).toBe(false);
  });

  it("Toth ganha do Tiny no desempate", () => {
    const r = resolveErpProvider(tinyOn, omieOff, tothOn("enrich_only"));
    expect(r.providerId).toBe("toth");
    expect(r.multipleConnected).toBe(true);
  });

  it("omitir o argumento do Toth mantém o comportamento anterior", () => {
    // Chamada de duas posições continua válida — nenhum call-site quebra.
    const r = resolveErpProvider(tinyOff, omieOn("enrich_only"));
    expect(r.providerId).toBe("omie");
    expect(r.multipleConnected).toBe(false);
  });

  it("invariante do manifesto: só o Toth declara receivables hoje", () => {
    expect(TOTH_CAPABILITIES.receivables).toBe(true);
    expect(OMIE_CAPABILITIES.receivables).toBe(false);
    expect(TINY_CAPABILITIES.receivables).toBe(false);
    // Integração somente leitura: nada é escrito de volta no ERP do cliente.
    expect(TOTH_CAPABILITIES.pushOrder).toBe(false);
  });
});
