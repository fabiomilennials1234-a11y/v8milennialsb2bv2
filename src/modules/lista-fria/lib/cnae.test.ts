import { describe, expect, it } from "vitest";

import cnaesOficiais from "../data/cnaes.json";
import {
  MAX_CNAES,
  adicionarPrefixo,
  buscarCnaes,
  contarDoPrefixo,
  descricaoDoPrefixo,
  digitosDoCodigo,
  formatarCnae,
  removerPrefixo,
  resumoDosCnaes,
  type Cnae,
} from "./cnae";
import { parseBusca, parseFiltrosCnpj, tituloDaBuscaCnpj } from "./tipos";

const LISTA: readonly Cnae[] = [
  ["4639701", "Comércio atacadista de produtos alimentícios em geral"],
  ["4639702", "Comércio atacadista de produtos alimentícios em geral, com fracionamento"],
  ["4641901", "Comércio atacadista de tecidos"],
  ["8630504", "Atividade odontológica"],
  ["8630501", "Atividade médica ambulatorial com recursos para realização de procedimentos cirúrgicos"],
];

describe("formatarCnae", () => {
  it.each([
    ["4639701", "4639-7/01"],
    ["463970", "4639-70*"],
    ["46397", "4639-7*"],
    ["4639", "4639*"],
    ["46", "46*"],
  ])("%s → %s", (entrada, esperado) => expect(formatarCnae(entrada)).toBe(esperado));
});

describe("digitosDoCodigo", () => {
  it.each([
    ["4639", "4639"],
    ["46.39-7/01", "4639701"],
    [" 46 ", "46"],
  ])("%j → %s", (e, esperado) => expect(digitosDoCodigo(e)).toBe(esperado));

  it.each(["", "4", "dentista", "46 atacado", "123456789"])("%j não é código", (e) => expect(digitosDoCodigo(e)).toBeNull());
});

describe("buscarCnaes", () => {
  it("por prefixo de código", () => {
    expect(buscarCnaes(LISTA, "4639").map(([c]) => c)).toEqual(["4639701", "4639702"]);
    expect(buscarCnaes(LISTA, "46.39-7/02").map(([c]) => c)).toEqual(["4639702"]);
  });
  it("por palavras da descrição, sem acento e sem ordem", () => {
    expect(buscarCnaes(LISTA, "odontologica").map(([c]) => c)).toEqual(["8630504"]);
    expect(buscarCnaes(LISTA, "alimenticios atacadista").map(([c]) => c)).toEqual(["4639701", "4639702"]);
    expect(buscarCnaes(LISTA, "ATIVIDADE").map(([c]) => c)).toEqual(["8630504", "8630501"]);
  });
  it("termo curto ou sem resultado devolve vazio; respeita o limite", () => {
    expect(buscarCnaes(LISTA, "")).toEqual([]);
    expect(buscarCnaes(LISTA, "a")).toEqual([]);
    expect(buscarCnaes(LISTA, "xyzxyz")).toEqual([]);
    expect(buscarCnaes(LISTA, "46", 1)).toHaveLength(1);
  });
});

describe("seleção por prefixo", () => {
  it("um grupo absorve os códigos que já estão dentro dele", () => {
    expect(adicionarPrefixo(["4639701", "8630504"], "4639")).toEqual(["8630504", "4639"]);
    expect(adicionarPrefixo(["4639701", "4641901"], "46")).toEqual(["46"]);
  });
  it("o que já está coberto não entra de novo", () => {
    expect(adicionarPrefixo(["4639"], "4639701")).toEqual(["4639"]);
    expect(adicionarPrefixo(["4639701"], "4639701")).toEqual(["4639701"]);
  });
  it("prefixo inválido é ignorado e o teto do banco é respeitado", () => {
    expect(adicionarPrefixo(["4639"], "x")).toEqual(["4639"]);
    expect(adicionarPrefixo(["4639"], "4")).toEqual(["4639"]);
    const cheia = Array.from({ length: MAX_CNAES }, (_, i) => String(1000000 + i));
    expect(adicionarPrefixo(cheia, "8630504")).toEqual(cheia);
  });
  it("remover tira só aquele", () => {
    expect(removerPrefixo(["4639", "8630504"], "4639")).toEqual(["8630504"]);
  });
  it("conta e descreve o grupo", () => {
    expect(contarDoPrefixo(LISTA, "4639")).toBe(2);
    expect(descricaoDoPrefixo(LISTA, "8630504")).toBe("Atividade odontológica");
    expect(descricaoDoPrefixo(LISTA, "4639")).toContain("e mais 1");
    expect(descricaoDoPrefixo(LISTA, "9999")).toBe("");
  });
  it("resumo para títulos", () => {
    expect(resumoDosCnaes([])).toBe("");
    expect(resumoDosCnaes(["4639701"])).toBe("CNAE 4639-7/01");
    expect(resumoDosCnaes(["46", "86"])).toBe("2 CNAEs");
  });
});

describe("lista oficial da Receita (data/cnaes.json)", () => {
  const lista = cnaesOficiais as unknown as readonly Cnae[];
  it("tem as subclasses, ordenadas, com acento preservado", () => {
    expect(lista.length).toBeGreaterThan(1300);
    expect(lista.every(([c]) => /^\d{7}$/.test(c))).toBe(true);
    expect([...lista].sort((a, b) => a[0].localeCompare(b[0]))).toEqual(lista);
    expect(lista.find(([c]) => c === "8630504")?.[1]).toBe("Atividade odontológica");
    expect(lista.some(([, d]) => d.includes("�"))).toBe(false);
  });
  it("acha o exemplo do CTO (dentistas) e o grupo de atacadistas", () => {
    expect(buscarCnaes(lista, "odontologica").map(([c]) => c)).toContain("8630504");
    expect(contarDoPrefixo(lista, "46")).toBeGreaterThan(50);
  });
});

describe("busca de CNPJ no vocabulário da tela", () => {
  it("lê os filtros do banco com segurança", () => {
    expect(parseFiltrosCnpj({ cnaes: ["4639701", 7, "86"], uf: "SP", municipio: "SAO PAULO", contato: "email" })).toEqual({
      cnaes: ["4639701", "86"],
      uf: "SP",
      municipio: "SAO PAULO",
      contato: "email",
    });
    expect(parseFiltrosCnpj(null)).toEqual({ cnaes: [], uf: "", municipio: null, contato: "qualquer" });
    expect(parseFiltrosCnpj([1, 2])).toEqual({ cnaes: [], uf: "", municipio: null, contato: "qualquer" });
    expect(parseFiltrosCnpj({ cnaes: ["46"], uf: "SP", contato: "sms" }).contato).toBe("qualquer");
  });
  it("título: um CNAE com cidade, vários só com o estado", () => {
    expect(tituloDaBuscaCnpj({ cnaes: ["4639701"], uf: "SP", municipio: "SAO PAULO", contato: "qualquer" })).toBe("CNAE 4639-7/01 · SAO PAULO - SP");
    expect(tituloDaBuscaCnpj({ cnaes: ["46", "86"], uf: "RJ", municipio: null, contato: "ambos" })).toBe("2 CNAEs · RJ");
  });
  it("parseBusca reconhece a fonte cnpj", () => {
    const b = parseBusca({
      id: "b", fonte: "cnpj", nicho: null, cidade: null, instagram_handle: null,
      filtros: { cnaes: ["8630504"], uf: "MG", municipio: null, contato: "telefone" },
      status: "concluida", etapa: null, progresso: 100, creditos_limite: 10, creditos_usados: 4,
      creditos_devolvidos: true, encontrados: 9, com_telefone: 4, com_email: 3, ja_leads: 0, sem_contato: 5,
      importados: 0, importada_em: null, erro: null, worker_id: null, heartbeat_at: null,
      started_at: null, finished_at: null, criado_por: null, organization_id: "o",
      created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z",
    });
    expect(b.fonte).toBe("cnpj");
    expect(b.titulo).toBe("CNAE 8630-5/04 · MG");
  });
});
