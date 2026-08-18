/**
 * Tests for _shared/erp/toth-mappers.ts.
 *
 * As fixtures reproduzem a ESTRUTURA exata dos retornos reais que o fornecedor
 * mandou em 2026-08-18 (`GET /clientes` e `POST /cobrancas`), com os valores
 * identificadores trocados — a forma é o que precisa ser travada por teste, e a
 * carteira de clientes da Café Jurerê não precisa morar no repositório.
 */
import { describe, it, expect } from "vitest";
import {
  pickField,
  digitsOnly,
  parseTothDate,
  extractRows,
  extractLoginToken,
  extractApiError,
  isAuthErrorMessage,
  pickEmail,
  pickPhone,
  deriveTituloStatus,
  mapTothClienteToCanonical,
  mapTothCobrancaToCanonical,
  TothMappingError,
} from "../../supabase/functions/_shared/erp/toth-mappers";

/** Forma real de um cliente do Toth. */
const CLIENTE_REAL = {
  numeroInscricaoEstadualST: "",
  nomeOrgaoExpedidorRg: "",
  tipoPessoa: "J",
  logradouroEntrega: "",
  UF: "SC",
  nomeFantasia: "TORREFACAO EXEMPLO LTDA",
  numeroInscricaoEstadual: "252947649",
  dataCadastro: "2011-11-29",
  numeroInscricao: "11222333000144",
  bairro: "PRAÇA",
  arquivos: [{ descricaoArquivo: "Orçamento", codigoArquivo: 896 }],
  redesSociais: [],
  emailNfe: "NFE@EXEMPLO.COM.BR",
  codigoTipoMercado: 23,
  razaoSocial: "TORREFACAO EXEMPLO COMERCIO DE ALIMENTOS LTDA",
  descricaoTipoMercado: "EMPRESA/GRUPO",
  cidade: "TIJUCAS",
  contribuinteIcms: "S",
  numero: "600",
  cep: "88200000",
  emails: [
    { tipo: "EMAIL", endereco: "Administrativo1@Exemplo.com.br", nomeContato: "Email", idContato: 118 },
  ],
  atendimentos: [{ codigoEmpresa: "1", nomeRepresentante: "TORREFAÇÃO", codigoRepresentante: "126" }],
  codigoGrupoParceiro: 3,
  situacaoParceiro: "0",
  telefones: [
    { prefixoArea: "48", numero: "32631404", isWhatsApp: "N", nomeContato: "", idContato: 117 },
  ],
  logradouro: "RUA AUGUSTO BAYER,",
  codigoCliente: 293,
};

/** Forma real de uma cobrança do Toth. */
const COBRANCA_REAL = {
  cdcontabanco: 1080,
  codigoPortador: 3356,
  instrucoes: "COBRA JUROS MORA DE 2% AO MES\n",
  dataEmissao: "17/08/2026",
  valorDocumento: 378,
  numeroConta: "15476-8",
  linhaDigitavel: "00190000090301158100000107554172615550000037800",
  codigoBanco: "001",
  numeroDocumento: "33976.1.4",
  id: 107554,
  numeroCarteira: "17",
  serienota: "4",
  cnpjCliente: "11222333000144",
  valorPago: 0,
  numeronota: 33976,
  valorDocumentoOriginal: 378,
  codigoCliente: 13642,
  dataVencimento: "31/08/2026",
  nossoNumero: "30115810000107554   ",
  numeroAgencia: "2723-5",
  cnpjEmpresa: "00214257000146",
};

describe("pickField", () => {
  it("casa ignorando caixa, acento e separador", () => {
    expect(pickField({ "Razão_Social": "X LTDA" }, ["razaoSocial"])).toBe("X LTDA");
  });

  it("respeita a ordem dos candidatos e pula o vazio", () => {
    expect(pickField({ nome: "Fantasia", razaoSocial: "Oficial" }, ["razaoSocial", "nome"])).toBe(
      "Oficial",
    );
    expect(pickField({ email: "", emailNfe: "a@b.com" }, ["email", "emailNfe"])).toBe("a@b.com");
  });
});

describe("digitsOnly", () => {
  it("tira máscara e trata número e vazio", () => {
    expect(digitsOnly("12.345.678/0001-90")).toBe("12345678000190");
    expect(digitsOnly(4832631404)).toBe("4832631404");
    expect(digitsOnly("---")).toBeNull();
  });
});

describe("parseTothDate", () => {
  it("aceita os DOIS formatos que a mesma API usa", () => {
    // dd/mm/aaaa no financeiro, aaaa-mm-dd no cadastro.
    expect(parseTothDate("31/08/2026")).toBe("2026-08-31");
    expect(parseTothDate("2011-11-29")).toBe("2011-11-29");
  });

  it("não confunde dia com mês", () => {
    expect(parseTothDate("01/12/2026")).toBe("2026-12-01");
  });

  it("recusa data impossível em vez de deixar passar", () => {
    // Aceitar 31/02 viraria título vencido fantasma na receita em risco.
    expect(parseTothDate("31/02/2026")).toBeNull();
    expect(parseTothDate("00/08/2026")).toBeNull();
    expect(parseTothDate("17-08-2026")).toBeNull();
    expect(parseTothDate("")).toBeNull();
  });
});

describe("extractApiError", () => {
  it("lê o erro do array de um elemento — a forma real do token expirado", () => {
    expect(extractApiError([{ error: "Acesso nao autorizado! " }])).toBe("Acesso nao autorizado!");
  });

  it("lê o erro também no objeto solto", () => {
    expect(extractApiError({ erro: "falhou" })).toBe("falhou");
  });

  it("devolve null para resposta de sucesso", () => {
    expect(extractApiError([CLIENTE_REAL])).toBeNull();
    expect(extractApiError([])).toBeNull();
  });
});

describe("isAuthErrorMessage", () => {
  it("reconhece a mensagem real de token vencido", () => {
    expect(isAuthErrorMessage("Acesso nao autorizado!")).toBe(true);
    expect(isAuthErrorMessage("Acesso não autorizado!")).toBe(true);
    expect(isAuthErrorMessage("Token invalido")).toBe(true);
  });

  it("não confunde erro de negócio com erro de auth", () => {
    expect(isAuthErrorMessage("CNPJ nao encontrado")).toBe(false);
  });
});

describe("extractLoginToken", () => {
  it("lê o token da resposta real de login", () => {
    expect(extractLoginToken({ login: "scl", user: "scl", token: "YFwBTn5fbgJq" })).toBe(
      "YFwBTn5fbgJq",
    );
  });

  it("aceita corpo em texto puro e recusa frase de erro", () => {
    expect(extractLoginToken("bF0LTn9QawdrXw==")).toBe("bF0LTn9QawdrXw==");
    expect(extractLoginToken("usuario ou senha invalidos")).toBeNull();
  });
});

describe("extractRows", () => {
  it("aceita o array cru na raiz — a forma real de /clientes", () => {
    expect(extractRows([CLIENTE_REAL])).toHaveLength(1);
  });

  it("ainda acha lista dentro de envelope, para outras instalações", () => {
    expect(extractRows({ clientes: [{ id: 1 }] })).toHaveLength(1);
  });

  it("devolve vazio quando não reconhece", () => {
    expect(extractRows({ total: 10 })).toEqual([]);
  });
});

describe("pickEmail / pickPhone — contato vem em LISTA, não em campo escalar", () => {
  it("lê o e-mail de emails[].endereco, normalizado em minúsculas", () => {
    expect(pickEmail(CLIENTE_REAL)).toBe("administrativo1@exemplo.com.br");
  });

  it("cai para emailNfe quando a lista está vazia", () => {
    expect(pickEmail({ ...CLIENTE_REAL, emails: [] })).toBe("nfe@exemplo.com.br");
  });

  it("monta o telefone juntando prefixoArea + numero", () => {
    expect(pickPhone(CLIENTE_REAL)).toBe("4832631404");
  });

  it("prefere o número marcado como WhatsApp, não o primeiro da lista", () => {
    // O primeiro do exemplo real é o fixo da recepção (isWhatsApp "N"). O Torque
    // é ferramenta de WhatsApp: o número que conversa vale mais.
    const row = {
      ...CLIENTE_REAL,
      telefones: [
        { prefixoArea: "48", numero: "32631404", isWhatsApp: "N" },
        { prefixoArea: "48", numero: "999750303", isWhatsApp: "S" },
      ],
    };
    expect(pickPhone(row)).toBe("48999750303");
  });

  it("aguenta lista ausente e entrada sem número", () => {
    expect(pickPhone({ codigoCliente: 1 })).toBeNull();
    expect(pickPhone({ telefones: [{ prefixoArea: "48" }] })).toBeNull();
  });
});

describe("mapTothClienteToCanonical", () => {
  it("mapeia o cliente real inteiro", () => {
    const c = mapTothClienteToCanonical(CLIENTE_REAL);
    expect(c.externalId).toBe("293");
    expect(c.cnpj).toBe("11222333000144");
    expect(c.name).toBe("TORREFACAO EXEMPLO COMERCIO DE ALIMENTOS LTDA");
    expect(c.company).toBe("TORREFACAO EXEMPLO LTDA");
    expect(c.email).toBe("administrativo1@exemplo.com.br");
    expect(c.phone).toBe("4832631404");
    expect(c.externalRef).toBeNull();
  });

  it("o CNPJ vem de numeroInscricao, não de um campo chamado cnpj", () => {
    // Foi o campo que o palpite errou antes de o payload real chegar.
    const { numeroInscricao, ...semInscricao } = CLIENTE_REAL;
    expect(numeroInscricao).toBeTruthy();
    expect(mapTothClienteToCanonical(semInscricao).cnpj).toBeNull();
  });

  it("usa codigoCliente como identificador, mesmo sendo número", () => {
    expect(mapTothClienteToCanonical({ codigoCliente: 88, razaoSocial: "X" }).externalId).toBe("88");
  });

  it("falha alto sem identificador — sem chave não há idempotência", () => {
    expect(() => mapTothClienteToCanonical({ razaoSocial: "Sem id" })).toThrow(TothMappingError);
  });
});

describe("deriveTituloStatus", () => {
  const HOJE = "2026-08-18";

  it("aberto quando não pago e ainda no prazo", () => {
    expect(deriveTituloStatus(378, 0, "2026-08-31", HOJE)).toBe("aberto");
  });

  it("atrasado quando venceu e não foi pago", () => {
    expect(deriveTituloStatus(378, 0, "2026-08-17", HOJE)).toBe("atrasado");
  });

  it("pago quando o valor pago cobre o documento, mesmo vencido", () => {
    expect(deriveTituloStatus(378, 378, "2026-01-01", HOJE)).toBe("pago");
  });

  it("pagamento PARCIAL não vira pago — limitação conhecida do retorno", () => {
    // O Toth manda valorPago, não status. Meio pagamento segue cobrável.
    expect(deriveTituloStatus(378, 100, "2026-08-31", HOJE)).toBe("aberto");
    expect(deriveTituloStatus(378, 100, "2026-08-01", HOJE)).toBe("atrasado");
  });

  it("sem vencimento legível fica aberto, nunca atrasado", () => {
    expect(deriveTituloStatus(378, 0, null, HOJE)).toBe("aberto");
  });
});

describe("mapTothCobrancaToCanonical", () => {
  it("mapeia a cobrança real", () => {
    const t = mapTothCobrancaToCanonical(COBRANCA_REAL, "2026-08-18");
    expect(t.externalId).toBe("107554");
    expect(t.clientExternalId).toBe("13642");
    expect(t.valor).toBe(378);
    expect(t.vencimento).toBe("2026-08-31");
    expect(t.status).toBe("aberto");
  });

  it("não inventa vínculo com pedido — o Toth liga à nota, não ao pedido", () => {
    expect(mapTothCobrancaToCanonical(COBRANCA_REAL, "2026-08-18").orderExternalId).toBeNull();
  });

  it("pagoEm é sempre null: o retorno não traz data de pagamento", () => {
    const pago = { ...COBRANCA_REAL, valorPago: 378 };
    const t = mapTothCobrancaToCanonical(pago, "2026-09-30");
    expect(t.status).toBe("pago");
    expect(t.pagoEm).toBeNull();
  });

  it("aceita valor com vírgula decimal, caso a instalação use locale pt-BR", () => {
    const t = mapTothCobrancaToCanonical(
      { ...COBRANCA_REAL, valorDocumento: "1.234,56" },
      "2026-08-18",
    );
    expect(t.valor).toBeCloseTo(1234.56);
  });

  it("falha alto sem identificador", () => {
    expect(() => mapTothCobrancaToCanonical({ valorDocumento: 10 }, "2026-08-18")).toThrow(
      TothMappingError,
    );
  });
});
