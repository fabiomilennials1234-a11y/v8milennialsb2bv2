import { describe, expect, it } from "vitest";

import { montarCsv, nomeDoArquivo } from "./csv";
import { extrairHandleDoInstagram } from "./instagram";
import { type Busca, type Resultado, buscaPedeRevisao, parseBusca, parseResultado } from "./tipos";

describe("extrairHandleDoInstagram (espelha lista_fria_busca_criar)", () => {
  it.each([
    ["https://www.instagram.com/clinicaodontovida/", "clinicaodontovida"],
    ["http://instagram.com/Clinica.Odonto_Vida?hl=pt-br", "clinica.odonto_vida"],
    ["instagram.com/clinicaodontovida#x", "clinicaodontovida"],
    ["@Clinica.Odonto_Vida", "clinica.odonto_vida"],
    ["  clinicaodontovida  ", "clinicaodontovida"],
    ["https://www.instagram.com/clinicaodontovida/followers/", "clinicaodontovida"],
  ])("%s → %s", (entrada, esperado) => {
    expect(extrairHandleDoInstagram(entrada)).toBe(esperado);
  });

  it.each([
    "",
    "   ",
    "https://www.instagram.com/p/abc123/",
    "https://www.instagram.com/reel/abc123/",
    "https://www.instagram.com/explore/",
    "https://instagram.com/",
    "https://example.com/clinica",
    "a".repeat(31),
    "dois nomes",
    "ação",
  ])("recusa %j", (entrada) => {
    expect(extrairHandleDoInstagram(entrada)).toBeNull();
  });
});

const resultado = (parcial: Partial<Resultado> = {}): Resultado => ({
  id: "r1",
  nome: "Clínica Sorriso",
  categoria: "Dentista",
  telefone: "5511938142207",
  email: "contato@sorriso.com.br",
  site: "https://sorriso.com.br",
  bairro: "Pinheiros",
  qualidade: "verificado",
  jaELead: false,
  selecionado: true,
  importado: false,
  ...parcial,
});

describe("montarCsv", () => {
  it("BOM, separador ; e CRLF para o Excel brasileiro", () => {
    const csv = montarCsv([resultado()]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [cab, linha] = csv.slice(1).split("\r\n");
    expect(cab).toBe('"Nome";"Categoria";"Telefone";"E-mail";"Site";"Bairro";"Qualidade";"Situação"');
    expect(linha).toBe(
      '"Clínica Sorriso";"Dentista";"5511938142207";"contato@sorriso.com.br";"https://sorriso.com.br";"Pinheiros";"Verificado";"Novo"',
    );
  });

  it("aspas dentro da célula dobram", () => {
    expect(montarCsv([resultado({ nome: 'Clínica "Sorriso"' })])).toContain('"Clínica ""Sorriso"""');
  });

  it.each(["=HYPERLINK(\"http://x\")", "+55 11 9", "-2+3", "@SOMA(A1)"])("neutraliza fórmula em %j (CSV injection)", (nome) => {
    const linha = montarCsv([resultado({ nome })]).split("\r\n")[1];
    expect(linha.startsWith(`"'${nome.replace(/"/g, '""')}"`)).toBe(true);
  });

  it("situação: já é lead e importado", () => {
    const csv = montarCsv([resultado({ jaELead: true }), resultado({ importado: true })]);
    expect(csv).toContain('"Já é lead"');
    expect(csv).toContain('"Importado"');
  });

  it("valor nulo vira célula vazia, não 'null'", () => {
    expect(montarCsv([resultado({ email: null, site: null })])).not.toContain("null");
  });
});

describe("nomeDoArquivo", () => {
  it("tira acento e símbolo, e leva a data", () => {
    expect(nomeDoArquivo("Dentistas · São Paulo - SP", new Date("2026-10-27T12:00:00Z"))).toBe(
      "lista-fria-dentistas-sao-paulo-sp-2026-10-27.csv",
    );
  });
  it("título vazio não gera nome vazio", () => {
    expect(nomeDoArquivo("···", new Date("2026-10-27T12:00:00Z"))).toBe("lista-fria-busca-2026-10-27.csv");
  });
});

const linhaDaBusca = {
  id: "b1",
  organization_id: "o1",
  fonte: "maps",
  nicho: "Dentistas",
  cidade: "São Paulo - SP",
  instagram_handle: null,
  status: "executando",
  etapa: "lendo_sites",
  progresso: 62,
  creditos_limite: 800,
  creditos_usados: 612,
  creditos_devolvidos: false,
  encontrados: 1904,
  com_telefone: 561,
  com_email: 318,
  ja_leads: 0,
  sem_contato: 0,
  importados: 0,
  importada_em: null,
  erro: null,
  worker_id: "w1",
  heartbeat_at: null,
  started_at: null,
  finished_at: null,
  criado_por: null,
  created_at: "2026-10-27T10:00:00Z",
  updated_at: "2026-10-27T10:00:00Z",
} as const;

describe("parseBusca", () => {
  it("monta o título por fonte", () => {
    expect(parseBusca({ ...linhaDaBusca }).titulo).toBe("Dentistas · São Paulo - SP");
    expect(parseBusca({ ...linhaDaBusca, fonte: "instagram", nicho: null, cidade: null, instagram_handle: "clinica" }).titulo).toBe("@clinica");
  });

  it("status e etapa desconhecidos caem num valor seguro, sem quebrar a tela", () => {
    const b = parseBusca({ ...linhaDaBusca, status: "inventado", etapa: "outra" });
    expect(b.status).toBe("falhou");
    expect(b.etapa).toBeNull();
  });

  it("pede revisão só quando terminou, achou algo e ainda não importou", () => {
    const base: Busca = parseBusca({ ...linhaDaBusca, status: "concluida", finished_at: "2026-10-27T11:00:00Z" });
    expect(buscaPedeRevisao(base)).toBe(true);
    expect(buscaPedeRevisao({ ...base, status: "executando" })).toBe(false);
    expect(buscaPedeRevisao({ ...base, status: "falhou" })).toBe(false);
    expect(buscaPedeRevisao({ ...base, creditosUsados: 0 })).toBe(false);
    expect(buscaPedeRevisao({ ...base, importadaEm: "2026-10-27T12:00:00Z" })).toBe(false);
  });
});

describe("parseResultado", () => {
  it("qualidade desconhecida vira não verificado; lead_id preenchido = importado", () => {
    const r = parseResultado({
      id: "r1", organization_id: "o1", busca_id: "b1", ref_externa: "p1", nome: "X", categoria: null,
      telefone: null, email: "x@y.z", site: null, endereco: null, bairro: null, instagram: null,
      qualidade: "estranha", ja_e_lead: false, selecionado: true, lead_id: "l1", importado_em: null,
      created_at: "2026-10-27T10:00:00Z",
    });
    expect(r.qualidade).toBe("nao_verificado");
    expect(r.importado).toBe(true);
  });
});
