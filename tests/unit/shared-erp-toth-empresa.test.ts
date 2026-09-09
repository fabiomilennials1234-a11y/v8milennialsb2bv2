/**
 * Filtro de empresa do grupo + enriquecimento do cliente do Toth.
 *
 * As fixtures reproduzem a estrutura de `atendimentos[]` observada em produção
 * (2026-08-21): a base da Café Jurerê atende quatro empresas do grupo na MESMA
 * resposta de `GET /clientes`, 878 clientes não têm atendimento nenhum e 111 são
 * atendidos por mais de uma. Os identificadores são inventados.
 */
import { describe, it, expect } from "vitest";
import {
  tothClienteEmpresas,
  tothClienteMatchesEmpresa,
  sameCompanyName,
  mapTothClienteToCanonical,
} from "../../supabase/functions/_shared/erp/toth-mappers";
import {
  clientEnrichmentColumns,
  leadEnrichmentColumns,
} from "../../supabase/functions/_shared/erp/sync/client-enrichment";

const atendimento = (empresa: string, representante: string, codigo = "10") => ({
  codigoEmpresa: 1,
  nomeFantasiaEmpresa: empresa,
  codigoRepresentante: codigo,
  nomeRepresentante: representante,
  emails: [],
  telefones: [],
  redesSociais: [],
});

const cliente = (over: Record<string, unknown> = {}) => ({
  codigoCliente: 4242,
  razaoSocial: "PADARIA MODELO LTDA",
  nomeFantasia: "Padaria Modelo",
  numeroInscricao: "11222333000181",
  situacaoParceiro: "1",
  descricaoTipoMercado: "TELEVENDAS-VAREJO  ",
  dataCadastro: "2024-03-15",
  cidade: "Florianópolis",
  UF: "sc",
  cep: "88000000",
  logradouro: "Rua das Flores",
  numero: "100",
  bairro: "Centro",
  tipoPessoa: "J",
  numeroInscricaoEstadual: "254123456",
  telefones: [{ prefixoArea: "48", numero: "999887766", isWhatsApp: "S" }],
  emails: [{ endereco: "Contato@Padaria.com.br", tipo: "P" }],
  atendimentos: [atendimento("CAFE JURERE", "MARIA SOUZA", "77")],
  ...over,
});

describe("empresas do grupo", () => {
  it("lista as empresas distintas de atendimentos[]", () => {
    const row = cliente({
      atendimentos: [
        atendimento("CAFE JURERE", "MARIA SOUZA"),
        atendimento("CAMIPLACE", "JOAO LIMA"),
        atendimento("CAFE JURERE", "MARIA SOUZA"),
      ],
    });
    expect(tothClienteEmpresas(row)).toEqual(["CAFE JURERE", "CAMIPLACE"]);
  });

  it("devolve lista vazia quando não há atendimento", () => {
    expect(tothClienteEmpresas(cliente({ atendimentos: [] }))).toEqual([]);
    expect(tothClienteEmpresas(cliente({ atendimentos: undefined }))).toEqual([]);
  });

  it("compara nome ignorando caixa e acento", () => {
    expect(sameCompanyName("CAFE JURERE", "Café Jurerê")).toBe(true);
    expect(sameCompanyName("CAFE JURERE", "CAMIPLACE")).toBe(false);
  });
});

describe("tothClienteMatchesEmpresa", () => {
  it("sem filtro, todo mundo entra — inclusive quem não tem atendimento", () => {
    expect(tothClienteMatchesEmpresa(cliente(), null)).toBe(true);
    expect(tothClienteMatchesEmpresa(cliente({ atendimentos: [] }), null)).toBe(true);
  });

  it("com filtro, deixa de fora cliente de outra empresa do grupo", () => {
    const outro = cliente({ atendimentos: [atendimento("CAMIPLACE", "JOAO LIMA")] });
    expect(tothClienteMatchesEmpresa(outro, "CAFE JURERE")).toBe(false);
    expect(tothClienteMatchesEmpresa(cliente(), "CAFE JURERE")).toBe(true);
  });

  it("cliente atendido por duas empresas entra pela que foi filtrada", () => {
    const duplo = cliente({
      atendimentos: [atendimento("CAMIPLACE", "JOAO LIMA"), atendimento("CAFE JURERE", "MARIA SOUZA")],
    });
    expect(tothClienteMatchesEmpresa(duplo, "CAFE JURERE")).toBe(true);
    expect(tothClienteMatchesEmpresa(duplo, "COSTA ESMERALDA")).toBe(false);
  });

  it("quem não tem atendimento fica fora por padrão, e entra se o admin pedir", () => {
    const orfao = cliente({ atendimentos: [] });
    expect(tothClienteMatchesEmpresa(orfao, "CAFE JURERE")).toBe(false);
    expect(tothClienteMatchesEmpresa(orfao, "CAFE JURERE", true)).toBe(true);
  });
});

describe("mapTothClienteToCanonical — enriquecimento", () => {
  it("traz representante, segmento, situação e endereço", () => {
    const c = mapTothClienteToCanonical(cliente(), { empresa: "CAFE JURERE" });
    expect(c.ownerName).toBe("MARIA SOUZA");
    expect(c.ownerExternalId).toBe("77");
    expect(c.erpCompany).toBe("CAFE JURERE");
    expect(c.segment).toBe("TELEVENDAS-VAREJO");
    expect(c.erpStatus).toBe("1");
    expect(c.registeredAt).toBe("2024-03-15");
    expect(c.city).toBe("Florianópolis");
    expect(c.uf).toBe("SC");
  });

  it("🔑 escolhe o representante DA EMPRESA FILTRADA, não o primeiro da lista", () => {
    const duplo = cliente({
      atendimentos: [
        atendimento("CAMIPLACE", "JOAO LIMA", "11"),
        atendimento("CAFE JURERE", "MARIA SOUZA", "77"),
      ],
    });
    const c = mapTothClienteToCanonical(duplo, { empresa: "CAFE JURERE" });
    expect(c.ownerName).toBe("MARIA SOUZA");
    expect(c.erpCompany).toBe("CAFE JURERE");
    // Sem filtro cai no primeiro — comportamento explícito, não acidente.
    expect(mapTothClienteToCanonical(duplo).ownerName).toBe("JOAO LIMA");
  });

  it("registra as demais empresas no metadata quando há mais de uma", () => {
    const duplo = cliente({
      atendimentos: [atendimento("CAFE JURERE", "MARIA"), atendimento("CAMIPLACE", "JOAO")],
    });
    const c = mapTothClienteToCanonical(duplo, { empresa: "CAFE JURERE" });
    expect(c.metadata?.empresasAtendimento).toEqual(["CAFE JURERE", "CAMIPLACE"]);
  });

  it("não inventa representante para quem não tem atendimento", () => {
    const c = mapTothClienteToCanonical(cliente({ atendimentos: [] }), { empresa: "CAFE JURERE" });
    expect(c.ownerName).toBeNull();
    expect(c.erpCompany).toBeNull();
  });

  it("UF inválida vira null — a coluna do CRM é char(2)", () => {
    expect(mapTothClienteToCanonical(cliente({ UF: "Santa Catarina" })).uf).toBeNull();
    expect(mapTothClienteToCanonical(cliente({ UF: "" })).uf).toBeNull();
    expect(mapTothClienteToCanonical(cliente({ UF: "sc" })).uf).toBe("SC");
  });

  it("situação do parceiro fica CRUA — 0 não é 'inativo' até o fornecedor dizer", () => {
    expect(mapTothClienteToCanonical(cliente({ situacaoParceiro: "0" })).erpStatus).toBe("0");
    expect(mapTothClienteToCanonical(cliente({ situacaoParceiro: "3" })).erpStatus).toBe("3");
  });

  it("metadata só carrega campo preenchido", () => {
    const c = mapTothClienteToCanonical(cliente({ site: "", complemento: "  " }));
    expect(c.metadata).not.toHaveProperty("site");
    expect(c.metadata).not.toHaveProperty("complemento");
    expect(c.metadata?.bairro).toBe("Centro");
  });
});

describe("colunas de escrita", () => {
  it("cliente da carteira recebe todo o enriquecimento", () => {
    const c = mapTothClienteToCanonical(cliente(), { empresa: "CAFE JURERE" });
    const cols = clientEnrichmentColumns(c);
    expect(cols.erp_owner_name).toBe("MARIA SOUZA");
    expect(cols.erp_company).toBe("CAFE JURERE");
    expect(cols.erp_segment).toBe("TELEVENDAS-VAREJO");
    expect(cols.erp_uf).toBe("SC");
    expect(cols.erp_registered_at).toBe("2024-03-15");
  });

  it("adapter que não produz enriquecimento não gera coluna nenhuma", () => {
    const omie = {
      externalId: "1",
      externalRef: null,
      cnpj: null,
      name: "X",
      company: null,
      email: null,
      phone: null,
    };
    expect(clientEnrichmentColumns(omie)).toEqual({});
    // O código do ERP é a exceção: todo adapter produz `externalId`, e é ele que
    // faz a tela do lead mostrar "1 - X" sem join com `upsell_clients`.
    expect(leadEnrichmentColumns(omie, "omie")).toEqual({ erp_code: "1" });
  });

  it("lead recebe segmento, UF e código do ERP, com a procedência carimbada", () => {
    const c = mapTothClienteToCanonical(cliente(), { empresa: "CAFE JURERE" });
    expect(leadEnrichmentColumns(c, "toth")).toEqual({
      segment: "TELEVENDAS-VAREJO",
      uf: "SC",
      // 🔴 `erp`, não `erp_toth`: `leads.uf_source` tem CHECK com vocabulário
      // fechado, e o valor composto derrubou 4 criações de cliente em produção.
      uf_source: "erp",
      // Identidade, não nome: `leads.name` continua "…" limpo, senão `{{nome}}`
      // do disparo passaria a dizer "Olá 4242 - Fulano".
      erp_code: "4242",
    });
  });

  it("código do ERP não entra em `leads.name`", () => {
    const c = mapTothClienteToCanonical(cliente(), { empresa: "CAFE JURERE" });
    expect(c.name).not.toContain(c.externalId);
  });

  it("sem UF, não carimba procedência de UF", () => {
    const c = mapTothClienteToCanonical(cliente({ UF: "" }));
    expect(leadEnrichmentColumns(c, "toth")).not.toHaveProperty("uf_source");
  });
});
