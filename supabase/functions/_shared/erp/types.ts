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

export interface CanonicalNfe {
  /** ERP's NF id (persisted as external_id). */
  externalId: string;
  externalRef: string | null;
  /** 44-digit access key. */
  chaveNfe: string | null;
  numero: string | null;
  valor: number;
  /** ISO emission date, or null. */
  dataEmissao: string | null;
  /** ERP NF status (autorizada, cancelada, ...). */
  status: string | null;
  /** ERP order id this NF invoices — used to link to the upsell_order. */
  orderExternalId: string | null;
}

export type TituloStatus = "aberto" | "pago" | "atrasado";

export interface CanonicalTitulo {
  externalId: string;
  externalRef: string | null;
  clientExternalId: string | null;
  orderExternalId: string | null;
  valor: number;
  /** Due date (ISO) or null — dd/mm/yyyy parsing deferred to the S1 spike. */
  vencimento: string | null;
  status: TituloStatus;
  /** Payment timestamp (ISO) or null. */
  pagoEm: string | null;
}
