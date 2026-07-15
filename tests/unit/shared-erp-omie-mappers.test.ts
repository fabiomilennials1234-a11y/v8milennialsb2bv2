/**
 * Tests for _shared/erp/omie-mappers.ts — Omie shapes → canonical entities (módulo C).
 * Guards against field drift between Omie's payload and our canonical model.
 */
import { describe, it, expect } from "vitest";
import {
  mapOmieClienteToCanonical,
  mapOmiePedidoToCanonical,
  mapOmieNfeToCanonical,
  mapOmieTituloToCanonical,
} from "../../supabase/functions/_shared/erp/omie-mappers";

describe("mapOmieClienteToCanonical", () => {
  it("maps identity, CNPJ (digits only), name and contact", () => {
    const c = mapOmieClienteToCanonical({
      codigo_cliente_omie: 12345,
      codigo_cliente_integracao: "our-uuid-1",
      cnpj_cpf: "12.345.678/0001-99",
      razao_social: "Acme Distribuidora LTDA",
      nome_fantasia: "Acme",
      email: "compras@acme.com",
      telefone1_ddd: "47",
      telefone1_numero: "99990000",
    });
    expect(c.externalId).toBe("12345");
    expect(c.externalRef).toBe("our-uuid-1");
    expect(c.cnpj).toBe("12345678000199");
    expect(c.name).toBe("Acme");
    expect(c.company).toBe("Acme Distribuidora LTDA");
    expect(c.email).toBe("compras@acme.com");
    expect(c.phone).toBe("4799990000");
  });

  it("falls back to razao_social when there is no nome_fantasia", () => {
    const c = mapOmieClienteToCanonical({
      codigo_cliente_omie: 7,
      razao_social: "Beta Comércio LTDA",
    });
    expect(c.name).toBe("Beta Comércio LTDA");
    expect(c.company).toBe("Beta Comércio LTDA");
  });

  it("returns nulls for missing optional fields and never a null externalId", () => {
    const c = mapOmieClienteToCanonical({ codigo_cliente_omie: 99 });
    expect(c.externalId).toBe("99");
    expect(c.externalRef).toBeNull();
    expect(c.cnpj).toBeNull();
    expect(c.email).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.company).toBeNull();
    expect(c.name).toBe("Cliente Omie");
  });
});

describe("mapOmiePedidoToCanonical", () => {
  it("maps identity, client ref, total and product name from the first item", () => {
    const o = mapOmiePedidoToCanonical({
      cabecalho: {
        codigo_pedido: 555,
        codigo_pedido_integracao: "ped-ref",
        codigo_cliente: 12345,
        numero_pedido: "1001",
        etapa: "50",
      },
      total_pedido: { valor_total_pedido: 1234.56 },
      det: [{ produto: { descricao: "Parafuso M8" } }],
    });
    expect(o.externalId).toBe("555");
    expect(o.externalRef).toBe("ped-ref");
    expect(o.clientExternalId).toBe("12345");
    expect(o.saleValue).toBe(1234.56);
    expect(o.productName).toBe("Parafuso M8");
    expect(o.etapa).toBe("50");
  });

  it("falls back to a numbered name when the order has no items", () => {
    const o = mapOmiePedidoToCanonical({
      cabecalho: { codigo_pedido: 9, codigo_cliente: 1, numero_pedido: "1002" },
      total_pedido: { valor_total_pedido: 10 },
    });
    expect(o.productName).toBe("Pedido Omie 1002");
    expect(o.externalRef).toBeNull();
    expect(o.saleValue).toBe(10);
  });
});

describe("mapOmieNfeToCanonical", () => {
  it("maps NF-e identity, chave, valor, status and the linked order id", () => {
    const nf = mapOmieNfeToCanonical({
      nIdNF: 987,
      cChaveNFe: "35200714200166000187550010000004451234567890",
      nNumeroNF: "445",
      nValorNF: 2500.0,
      cStatus: "Autorizada",
      nCodPedido: 555,
    });
    expect(nf.externalId).toBe("987");
    expect(nf.chaveNfe).toBe("35200714200166000187550010000004451234567890");
    expect(nf.numero).toBe("445");
    expect(nf.valor).toBe(2500);
    expect(nf.status).toBe("Autorizada");
    expect(nf.orderExternalId).toBe("555");
  });

  it("defaults missing fields to null / zero", () => {
    const nf = mapOmieNfeToCanonical({ nIdNF: 1 });
    expect(nf.externalId).toBe("1");
    expect(nf.chaveNfe).toBeNull();
    expect(nf.valor).toBe(0);
    expect(nf.orderExternalId).toBeNull();
    expect(nf.status).toBeNull();
  });
});

describe("mapOmieTituloToCanonical", () => {
  it("maps identity, valor and client/order refs", () => {
    const t = mapOmieTituloToCanonical({
      codigo_lancamento_omie: 44001,
      codigo_lancamento_integracao: "tit-ref",
      codigo_cliente_fornecedor: 12345,
      nCodPedido: 555,
      valor_documento: 800.5,
      status_titulo: "ABERTO",
    });
    expect(t.externalId).toBe("44001");
    expect(t.externalRef).toBe("tit-ref");
    expect(t.clientExternalId).toBe("12345");
    expect(t.orderExternalId).toBe("555");
    expect(t.valor).toBe(800.5);
    expect(t.status).toBe("aberto");
  });

  it("is pago when a payment date is present", () => {
    const t = mapOmieTituloToCanonical({
      codigo_lancamento_omie: 1,
      status_titulo: "RECEBIDO",
      data_pagamento: "10/07/2026",
    });
    expect(t.status).toBe("pago");
  });

  it("is atrasado when the status marks it overdue", () => {
    const t = mapOmieTituloToCanonical({ codigo_lancamento_omie: 2, status_titulo: "ATRASADO" });
    expect(t.status).toBe("atrasado");
  });

  it("defaults to aberto otherwise", () => {
    const t = mapOmieTituloToCanonical({ codigo_lancamento_omie: 3 });
    expect(t.status).toBe("aberto");
    expect(t.valor).toBe(0);
    expect(t.clientExternalId).toBeNull();
  });
});
