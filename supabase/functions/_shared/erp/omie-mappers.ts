/**
 * Omie payload → canonical entity mappers (módulo C, ADR-0020).
 * Pure functions. The double key is persisted: codigo_cliente_omie → externalId
 * (immutable), codigo_cliente_integracao → externalRef (our uuid bridge).
 */

import { CanonicalClient, CanonicalOrder, CanonicalNfe } from "./types.ts";

export interface OmieClienteRaw {
  codigo_cliente_omie?: number | string;
  codigo_cliente_integracao?: string | null;
  cnpj_cpf?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  email?: string | null;
  telefone1_ddd?: string | null;
  telefone1_numero?: string | null;
}

/** Digits only; empty → null. */
function digits(v?: string | null): string | null {
  if (!v) return null;
  const d = String(v).replace(/\D/g, "");
  return d.length > 0 ? d : null;
}

function trimOrNull(v?: string | null): string | null {
  const t = (v ?? "").toString().trim();
  return t.length > 0 ? t : null;
}

export function mapOmieClienteToCanonical(raw: OmieClienteRaw): CanonicalClient {
  const company = trimOrNull(raw.razao_social);
  const fantasia = trimOrNull(raw.nome_fantasia);
  const ddd = digits(raw.telefone1_ddd) ?? "";
  const num = digits(raw.telefone1_numero) ?? "";
  const phone = `${ddd}${num}`;

  return {
    externalId: String(raw.codigo_cliente_omie ?? "").trim(),
    externalRef: trimOrNull(raw.codigo_cliente_integracao),
    cnpj: digits(raw.cnpj_cpf),
    name: fantasia ?? company ?? "Cliente Omie",
    company,
    email: trimOrNull(raw.email),
    phone: phone.length > 0 ? phone : null,
  };
}

export interface OmiePedidoRaw {
  cabecalho?: {
    codigo_pedido?: number | string;
    codigo_pedido_integracao?: string | null;
    codigo_cliente?: number | string;
    numero_pedido?: number | string;
    etapa?: string | null;
  };
  total_pedido?: { valor_total_pedido?: number | string };
  det?: Array<{ produto?: { descricao?: string | null } }>;
}

export function mapOmiePedidoToCanonical(raw: OmiePedidoRaw): CanonicalOrder {
  const cab = raw.cabecalho ?? {};
  const firstDesc = trimOrNull(raw.det?.[0]?.produto?.descricao);
  const numero = cab.numero_pedido != null ? String(cab.numero_pedido) : "";

  return {
    externalId: String(cab.codigo_pedido ?? "").trim(),
    externalRef: trimOrNull(cab.codigo_pedido_integracao),
    clientExternalId: String(cab.codigo_cliente ?? "").trim(),
    saleValue: Number(raw.total_pedido?.valor_total_pedido ?? 0),
    productName: firstDesc ?? (numero ? `Pedido Omie ${numero}` : "Pedido Omie"),
    // Omie dates are dd/mm/yyyy; parsing is deferred to the S1 API spike. Until
    // then sold_at defaults to now() in the DB.
    soldAt: null,
    etapa: trimOrNull(cab.etapa),
  };
}

// NOTE: exact Omie ListarNF field names are to be confirmed in the S1 spike.
// The mapping is isolated here — only this function changes if names differ.
export interface OmieNfeRaw {
  nIdNF?: number | string;
  cChaveNFe?: string | null;
  nNumeroNF?: string | number | null;
  dEmissao?: string | null;
  nValorNF?: number | string | null;
  cStatus?: string | null;
  nCodPedido?: number | string | null;
}

export function mapOmieNfeToCanonical(raw: OmieNfeRaw): CanonicalNfe {
  const numero = raw.nNumeroNF != null ? String(raw.nNumeroNF).trim() : null;
  const orderId = raw.nCodPedido != null ? String(raw.nCodPedido).trim() : "";

  return {
    externalId: String(raw.nIdNF ?? "").trim(),
    externalRef: null,
    chaveNfe: digits(raw.cChaveNFe),
    numero: numero && numero.length > 0 ? numero : null,
    valor: Number(raw.nValorNF ?? 0),
    // dd/mm/yyyy parsing deferred to the S1 spike.
    dataEmissao: null,
    status: trimOrNull(raw.cStatus),
    orderExternalId: orderId.length > 0 ? orderId : null,
  };
}
