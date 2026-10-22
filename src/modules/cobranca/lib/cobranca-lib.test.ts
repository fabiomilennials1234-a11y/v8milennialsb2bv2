import { describe, expect, it } from "vitest";

import { atrasoDe, diaCurto, faixaDoAtraso, haQuantoTempo, recorteDeVencimento, tomDoAtraso } from "./atraso";
import { documentoValido, formatarDocumento, formatarTelefone, normalizarTelefone, telefoneValido } from "./documento";
import { reaisCompacto, iniciais } from "./formato";
import { camposFaltando, detectarColunas, lerData, lerValor, montarLinhas } from "./planilha";
import { gerarParcelas, maisMeses } from "./parcelas";
import { proximaAcao } from "./proxima-acao";
import { parseImportacao, parseMetricas, parseResumo, type InadimplenteResumo } from "./tipos";

const HOJE = new Date(2026, 9, 21, 15, 0); // 21/10/2026, hora local

describe("atraso", () => {
  it("conta dias pelo calendário local e rotula", () => {
    expect(atrasoDe("2026-10-21", HOJE)).toEqual({ dias: 0, tom: "neutro", rotulo: "vence hoje" });
    expect(atrasoDe("2026-10-20", HOJE)?.rotulo).toBe("1 dia");
    expect(atrasoDe("2026-09-04", HOJE)).toEqual({ dias: 47, tom: "alerta", rotulo: "47 dias" });
    expect(atrasoDe("2026-10-22", HOJE)?.rotulo).toBe("vence amanhã");
    expect(atrasoDe("2026-10-25", HOJE)?.rotulo).toBe("vence em 4 dias");
    expect(atrasoDe(null, HOJE)).toBeNull();
  });

  it("tom do selo segue 15/30/60; faixa da carteira segue 30/60/90", () => {
    expect([1, 15, 16, 30, 31, 60, 61].map(tomDoAtraso)).toEqual([
      "atencao", "atencao", "aviso", "aviso", "alerta", "alerta", "critico",
    ]);
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(faixaDoAtraso)).toEqual([
      "a_vencer", "ate_30", "ate_30", "ate_60", "ate_60", "ate_90", "ate_90", "acima_90",
    ]);
  });

  it("recorte de vencimento bate com as faixas", () => {
    expect(recorteDeVencimento("ate_30", HOJE)).toEqual({ gte: "2026-09-21", lte: "2026-10-20" });
    expect(recorteDeVencimento("acima_90", HOJE)).toEqual({ lte: "2026-07-22" });
    expect(recorteDeVencimento("a_vencer", HOJE)).toEqual({ gte: "2026-10-21" });
    // Fronteiras: 30 dias é ate_30, 31 já é ate_60.
    expect(faixaDoAtraso(atrasoDe("2026-09-21", HOJE)!.dias)).toBe("ate_30");
    expect(faixaDoAtraso(atrasoDe("2026-09-20", HOJE)!.dias)).toBe("ate_60");
  });

  it("datas curtas e tempo relativo", () => {
    expect(diaCurto("2026-09-04", HOJE)).toBe("04/09");
    expect(diaCurto("2025-12-31", HOJE)).toBe("31/12/25");
    expect(haQuantoTempo(new Date(2026, 9, 21, 14, 25).toISOString(), HOJE)).toBe("há 35 min");
    expect(haQuantoTempo(new Date(2026, 9, 21, 13, 0).toISOString(), HOJE)).toBe("há 2 h");
    expect(haQuantoTempo(new Date(2026, 9, 15, 9, 0).toISOString(), HOJE)).toBe("há 6 dias");
  });
});

describe("documento e telefone", () => {
  it("confere dígitos de CPF e CNPJ", () => {
    expect(documentoValido("529.982.247-25")).toBe(true);
    expect(documentoValido("529.982.247-24")).toBe(false);
    expect(documentoValido("11.222.333/0001-81")).toBe(true);
    expect(documentoValido("11.222.333/0001-80")).toBe(false);
    expect(documentoValido("111.111.111-11")).toBe(false);
    expect(documentoValido("")).toBe(true);
    expect(documentoValido("123")).toBe(false);
  });

  it("formata documento e telefone", () => {
    expect(formatarDocumento("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarDocumento("52998224725")).toBe("529.982.247-25");
    expect(normalizarTelefone("(48) 99999-0001")).toBe("5548999990001");
    expect(normalizarTelefone("+55 48 3333-4444")).toBe("554833334444");
    expect(normalizarTelefone("")).toBeNull();
    expect(formatarTelefone("5548999990001")).toBe("(48) 99999-0001");
    expect(formatarTelefone("554833334444")).toBe("(48) 3333-4444");
    expect(formatarTelefone("351912345678")).toBe("+351912345678");
    expect(telefoneValido("123")).toBe(false);
  });
});

describe("planilha", () => {
  it("detecta colunas pelos nomes de mercado", () => {
    const mapa = detectarColunas([
      "Razão Social", "CNPJ", "Telefone", "E-mail", "Nº do Título", "Valor Original", "Saldo", "Data de Vencimento", "Cidade", "Contato",
    ]);
    expect(mapa).toMatchObject({
      nome: 0, documento: 1, telefone: 2, email: 3, numero: 4, valor: 6, vencimento: 7, cidade: 8, contato_nome: 9,
    });
    expect(camposFaltando(mapa)).toEqual([]);
  });

  it("'Número do documento' é do título, não CPF/CNPJ", () => {
    const mapa = detectarColunas(["Cliente", "Número do documento", "CPF/CNPJ", "Valor", "Vencimento"]);
    expect(mapa.numero).toBe(1);
    expect(mapa.documento).toBe(2);
    expect(mapa.nome).toBe(0);
  });

  it("aponta o que falta", () => {
    expect(camposFaltando(detectarColunas(["Cliente", "Telefone"]))).toEqual(["valor", "vencimento"]);
  });

  it("lê valor brasileiro e internacional", () => {
    expect(lerValor("R$ 1.234,56")).toBe(1234.56);
    expect(lerValor("1234,5")).toBe(1234.5);
    expect(lerValor("1.234")).toBe(1234);
    expect(lerValor("12.345.678")).toBe(12345678);
    expect(lerValor("1234.56")).toBe(1234.56);
    expect(lerValor("1,234.56")).toBe(1234.56);
    expect(lerValor(980)).toBe(980);
    expect(lerValor("abc")).toBeNull();
  });

  it("lê data dd/mm, ISO, Date do exceljs e série do Excel", () => {
    expect(lerData("04/09/2026")).toBe("2026-09-04");
    expect(lerData("4/9/26")).toBe("2026-09-04");
    expect(lerData("2026-09-04")).toBe("2026-09-04");
    expect(lerData(new Date(Date.UTC(2026, 8, 4)))).toBe("2026-09-04");
    expect(lerData(46269)).toBe("2026-09-04");
    expect(lerData("31/02/2026")).toBeNull();
    expect(lerData("ontem")).toBeNull();
  });

  it("monta linhas para a RPC, pula vazias e guarda a linha original", () => {
    const mapa = detectarColunas(["Nome", "CNPJ", "Valor", "Vencimento"]);
    const { linhas, linhaNaPlanilha } = montarLinhas(
      [
        ["Padaria", "08.771.245/0001-63", "3.456,20", "13/09/2026"],
        [null, "", "", ""],
        ["Mercado", "", 11640, "data ruim"],
      ],
      mapa,
    );
    expect(linhas).toEqual([
      { nome: "Padaria", documento: "08.771.245/0001-63", valor: 3456.2, vencimento: "2026-09-13" },
      { nome: "Mercado", valor: 11640, vencimento: "data ruim" },
    ]);
    expect(linhaNaPlanilha).toEqual([2, 4]);
  });
});

describe("formatos e parsers", () => {
  it("compacta dinheiro e tira iniciais", () => {
    expect(reaisCompacto(487_300)).toBe("R$ 487,3 mil");
    expect(reaisCompacto(1_250_000)).toBe("R$ 1,3 mi");
    expect(reaisCompacto(980)).toBe("R$ 980");
    expect(iniciais("Restaurante Maré Alta Ltda")).toBe("RM");
    expect(iniciais("padaria")).toBe("PA");
  });

  it("converte o resumo e as métricas sem NaN", () => {
    const r = parseResumo({
      id: "1", nome: "X", origem: "manual", created_at: "2026-10-21T00:00:00Z", nao_contatar: false,
      saldo_aberto: "14230.50", titulos_abertos: 2, posicao: 1, caso_id: null,
    });
    expect(r.saldoAberto).toBe(14230.5);
    expect(r.casoId).toBeNull();
    const m = parseMetricas({ em_aberto: "1300.00", faixas: { ate_90: "1000.00" }, dias_ate_pagar_mediana: null });
    expect(m.emAberto).toBe(1300);
    expect(m.faixas.ate90).toBe(1000);
    expect(m.faixas.acima90).toBe(0);
    expect(m.diasAtePagarMediana).toBeNull();
    const i = parseImportacao({ dry_run: true, linhas_invalidas: [{ linha: 5, motivo: "sem nome" }] });
    expect(i.linhasInvalidas).toEqual([{ linha: 5, motivo: "sem nome" }]);
  });
});

describe("parcelas", () => {
  it("segura o fim do mês e divide em centavos sem perder nenhum", () => {
    expect(maisMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(maisMeses("2026-10-15", 3)).toBe("2027-01-15");
    const p = gerarParcelas(100, 3, "2026-10-25");
    expect(p.map((x) => x.valor)).toEqual([33.33, 33.33, 33.34]);
    expect(p.map((x) => x.vencimento)).toEqual(["2026-10-25", "2026-11-25", "2026-12-25"]);
    expect(Math.round(p.reduce((s, x) => s + x.valor, 0) * 100)).toBe(10000);
    expect(gerarParcelas(0, 3, "2026-10-25")).toEqual([]);
  });
});

describe("próxima ação", () => {
  const base: InadimplenteResumo = parseResumo({
    id: "i", nome: "X", origem: "manual", created_at: "2026-10-01T00:00:00Z", nao_contatar: false,
    caso_id: "c", etapa_id: "e", responsavel_id: "r", saldo_aberto: 100, titulos_abertos: 1,
  });

  it("compromisso manda; vencido vira alerta", () => {
    const hoje = HOJE;
    expect(proximaAcao({ ...base, compromissoTipo: "promessa", compromissoProximaVencimento: "2026-10-23", compromissoProximaValor: 50 }, hoje).texto)
      .toBe("Promessa 23/10 · R$ 50,00");
    expect(proximaAcao({ ...base, compromissoTipo: "acordo", compromissoProximaVencimento: "2026-10-21", compromissoProximaValor: 10 }, hoje).texto)
      .toMatch(/^Parcela hoje/);
    expect(proximaAcao({ ...base, compromissoTipo: "promessa", compromissoProximaVencimento: "2026-10-19" }, hoje).tom).toBe("alerta");
  });

  it("sem dono, sem contato e não contatar", () => {
    expect(proximaAcao({ ...base, responsavelId: null }, HOJE).icone).toBe("sem_dono");
    expect(proximaAcao(base, HOJE).texto).toBe("Nenhum contato registrado");
    expect(proximaAcao({ ...base, ultimoContatoEm: new Date(2026, 9, 10).toISOString() }, HOJE).texto).toBe("Sem contato há 11 dias");
    expect(proximaAcao({ ...base, naoContatar: true }, HOJE).icone).toBe("nao_contatar");
    expect(proximaAcao({ ...base, casoId: null, ultimoDesfecho: "recuperado" }, HOJE).texto).toBe("Recuperado");
  });
});
