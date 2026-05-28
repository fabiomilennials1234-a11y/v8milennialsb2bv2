/**
 * `computeNeedsDeepLinkResolve` — decide se o `ChatShellWithContext` precisa
 * disparar `useResolveChatDeepLink` no servidor.
 *
 * Curto-circuita quando o link já trouxe uma instância válida (`?instance=Y`
 * vindo do Kanban via `primaryInstanceFor`). Match exato em allowed garante
 * defesa multi-tenant.
 */
import { describe, it, expect } from "vitest";
import { computeNeedsDeepLinkResolve } from "@/modules/communication/lib/computeNeedsDeepLinkResolve";

describe("computeNeedsDeepLinkResolve", () => {
  it("não resolve quando phone ausente", () => {
    expect(
      computeNeedsDeepLinkResolve({
        hasDeepLinkPhone: false,
        deepLinkProcessed: false,
        instancesCount: 2,
        deepLinkInstance: null,
        allowedInstanceIds: ["i1", "i2"],
      }),
    ).toBe(false);
  });

  it("não resolve quando ainda não há instâncias permitidas carregadas", () => {
    expect(
      computeNeedsDeepLinkResolve({
        hasDeepLinkPhone: true,
        deepLinkProcessed: false,
        instancesCount: 0,
        deepLinkInstance: null,
        allowedInstanceIds: [],
      }),
    ).toBe(false);
  });

  it("não resolve quando deep-link já foi processado", () => {
    expect(
      computeNeedsDeepLinkResolve({
        hasDeepLinkPhone: true,
        deepLinkProcessed: true,
        instancesCount: 2,
        deepLinkInstance: null,
        allowedInstanceIds: ["i1", "i2"],
      }),
    ).toBe(false);
  });

  it("CURTO-CIRCUITO: não resolve quando URL traz instância válida", () => {
    expect(
      computeNeedsDeepLinkResolve({
        hasDeepLinkPhone: true,
        deepLinkProcessed: false,
        instancesCount: 2,
        deepLinkInstance: "i1",
        allowedInstanceIds: ["i1", "i2"],
      }),
    ).toBe(false);
  });

  it("resolve quando URL traz instância NÃO permitida (defesa multi-tenant)", () => {
    expect(
      computeNeedsDeepLinkResolve({
        hasDeepLinkPhone: true,
        deepLinkProcessed: false,
        instancesCount: 2,
        deepLinkInstance: "FORBIDDEN",
        allowedInstanceIds: ["i1", "i2"],
      }),
    ).toBe(true);
  });

  it("resolve quando phone vem mas URL não tem instance", () => {
    expect(
      computeNeedsDeepLinkResolve({
        hasDeepLinkPhone: true,
        deepLinkProcessed: false,
        instancesCount: 2,
        deepLinkInstance: null,
        allowedInstanceIds: ["i1", "i2"],
      }),
    ).toBe(true);
  });
});
