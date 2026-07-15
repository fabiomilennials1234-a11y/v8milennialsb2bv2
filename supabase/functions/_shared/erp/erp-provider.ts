/**
 * ERPProvider — the provider-neutral contract every ERP integration implements.
 *
 * Per ADR-0020, this is a **capability manifest** plus segregated method groups:
 * a provider declares only the capabilities it supports, and the UI reads the
 * manifest to show or hide each Carteira surface. It is deliberately NOT a
 * lowest-common-denominator interface, and NOT a fat interface that throws
 * `NotSupported` at runtime. Omie and TinyERP are the first two implementations.
 */

/** The units of ERP functionality a provider may support. */
export type ERPCapability =
  | "clientes"
  | "pedidos"
  | "produtos"
  | "notaFiscal"
  | "receivables"
  | "webhooks";

/**
 * The contract. Capability method groups are added by later slices, each
 * optional and present only when the matching capability is declared.
 */
export interface ERPProvider {
  /** Stable provider id, e.g. "omie" | "tiny". */
  readonly id: string;
  /** What this provider can do — the manifest the UI keys off. */
  readonly capabilities: readonly ERPCapability[];
}

/** True when the provider declares the given capability. */
export function providerSupports(provider: ERPProvider, capability: ERPCapability): boolean {
  return provider.capabilities.includes(capability);
}
