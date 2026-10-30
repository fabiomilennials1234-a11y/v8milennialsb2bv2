import { describe, expect, it } from "vitest";

import { localDoTextoDeCidade } from "./local";
import {
  montarArquivoMeta,
  nomeDoArquivoMeta,
  normalizarCidade,
  normalizarEmail,
  normalizarTelefone,
} from "./meta";
import type { Resultado } from "./tipos";

const resultado = (parcial: Partial<Resultado> = {}): Resultado => ({
  id: "r1",
  nome: "Clínica Sorriso",
  categoria: "Dentista",
  telefone: "5511938142207",
  email: "Contato@Sorriso.com.br",
  site: null,
  bairro: null,
  qualidade: "verificado",
  jaELead: false,
  selecionado: true,
  importado: false,
  ...parcial,
});

const SP = { cidade: "São Paulo", uf: "SP" };

describe("montarArquivoMeta", () => {
  it("cabeçalho do Meta, vírgula, CRLF e sem BOM; Maps leva ct/st/country, sem fn/ln", () => {
    const { csv, linhas, descartados } = montarArquivoMeta([resultado()], "maps", SP);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.split("\r\n")).toEqual([
      "email,phone,ct,st,country",
      "contato@sorriso.com.br,5511938142207,saopaulo,sp,br",
    ]);
    expect(linhas).toBe(1);
    expect(descartados).toBe(0);
  });

  it("Instagram leva fn/ln e nenhuma coluna de lugar", () => {
    const { csv } = montarArquivoMeta([resultado({ nome: "Maria da Silva" })], "instagram");
    expect(csv.split("\r\n")).toEqual(["email,phone,fn,ln", "contato@sorriso.com.br,5511938142207,maria,silva"]);
  });

  it("nome de uma palavra só: fn sem ln; emoji e pontuação saem", () => {
    const { csv } = montarArquivoMeta([resultado({ nome: "✨ Ana-Paula ✨" })], "instagram");
    expect(csv.split("\r\n")).toEqual(["email,phone,fn", "contato@sorriso.com.br,5511938142207,anapaula"]);
  });

  it("CNPJ sem município: só UF e país", () => {
    const { csv } = montarArquivoMeta([resultado()], "cnpj", { cidade: null, uf: "SC" });
    expect(csv.split("\r\n")[0]).toBe("email,phone,st,country");
  });

  it("coluna vazia em todas as linhas não vai no arquivo", () => {
    const { csv } = montarArquivoMeta([resultado({ email: null })], "maps", SP);
    expect(csv.split("\r\n")[0]).toBe("phone,ct,st,country");
  });

  it("e-mail que não confere sai, o telefone fica", () => {
    const { csv } = montarArquivoMeta([resultado({ qualidade: "email_invalido" })], "maps", SP);
    expect(csv.split("\r\n")[1]).toBe("5511938142207,saopaulo,sp,br");
  });

  it("sem e-mail nem telefone aproveitável: a linha é descartada", () => {
    const r = montarArquivoMeta(
      [resultado({ email: null, telefone: null }), resultado({ email: "x@y.com", telefone: null })],
      "maps",
      SP,
    );
    expect(r.linhas).toBe(1);
    expect(r.descartados).toBe(1);
  });

  it("repetido: o identificador repetido sai da 2ª linha, o resto fica; duplicata total some", () => {
    const r = montarArquivoMeta(
      [
        resultado({ id: "1" }),
        resultado({ id: "2", email: "contato@sorriso.com.br", telefone: "5511911112222" }),
        resultado({ id: "3" }),
      ],
      "maps",
      SP,
    );
    expect(r.csv.split("\r\n").slice(1)).toEqual([
      "contato@sorriso.com.br,5511938142207,saopaulo,sp,br",
      ",5511911112222,saopaulo,sp,br",
    ]);
    expect(r.descartados).toBe(1);
  });

  it.each(["=cmd@evil.com", "+a@b.com", "-a@b.com", "@a.com", "a b@c.com", 'a"b@c.com'])(
    "e-mail %j não entra (CSV injection e lixo)",
    (email) => {
      expect(montarArquivoMeta([resultado({ email, telefone: null })], "maps", SP).linhas).toBe(0);
    },
  );

  it("nada aproveitável: csv vazio, sem cabeçalho solto", () => {
    expect(montarArquivoMeta([], "maps", SP)).toEqual({ csv: "", linhas: 0, descartados: 0 });
  });
});

describe("normalizadores", () => {
  it("telefone: só dígitos, sem zero à esquerda, 10 a 15", () => {
    expect(normalizarTelefone("+55 (11) 93814-2207")).toBe("5511938142207");
    expect(normalizarTelefone("0055119")).toBe("");
    expect(normalizarTelefone(null)).toBe("");
  });

  it("e-mail: minúsculo e aparado", () => {
    expect(normalizarEmail("  A@B.COM ")).toBe("a@b.com");
    expect(normalizarEmail("sem-arroba")).toBe("");
  });

  it("cidade: só a-z, sem acento nem espaço", () => {
    expect(normalizarCidade("São José dos Pinhais")).toBe("saojosedospinhais");
    expect(normalizarCidade("SAO PAULO")).toBe("saopaulo");
  });
});

describe("localDoTextoDeCidade", () => {
  it.each([
    ["São Paulo - SP", { cidade: "São Paulo", uf: "SP" }],
    ["Florianópolis – sc", { cidade: "Florianópolis", uf: "SC" }],
    ["Curitiba", { cidade: "Curitiba", uf: null }],
    ["", { cidade: null, uf: null }],
  ])("%j", (entrada, esperado) => {
    expect(localDoTextoDeCidade(entrada)).toEqual(esperado);
  });
});

describe("nomeDoArquivoMeta", () => {
  it("prefixo publico-meta, título sem acento e data", () => {
    expect(nomeDoArquivoMeta("Dentistas · São Paulo - SP", new Date("2026-10-30T12:00:00Z"))).toBe(
      "publico-meta-dentistas-sao-paulo-sp-2026-10-30.csv",
    );
  });
});
