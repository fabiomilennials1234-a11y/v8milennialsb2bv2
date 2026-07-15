/**
 * Canonical ERP entities — provider-neutral shapes every adapter maps into
 * (ADR-0020). Providers translate their payloads to these; the sync layer only
 * ever sees canonical types.
 */

export interface CanonicalClient {
  /** ERP's immutable id (persisted as external_id). */
  externalId: string;
  /** Our uuid bridge for upsert (external_ref), when the ERP echoes it. */
  externalRef: string | null;
  /** CNPJ/CPF, digits only. The cross-provider match key. */
  cnpj: string | null;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
}

export interface CanonicalOrder {
  /** ERP's immutable order id (persisted as external_id). */
  externalId: string;
  externalRef: string | null;
  /** ERP id of the order's client — used to resolve the Carteira Client. */
  clientExternalId: string;
  saleValue: number;
  productName: string;
  /** ISO sale date, or null → let the DB default to now(). */
  soldAt: string | null;
  /** ERP-side stage (Omie's etapa). NOT the CRM pipeline stage. */
  etapa: string | null;
}
