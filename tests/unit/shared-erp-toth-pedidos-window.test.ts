/**
 * Tests for _shared/erp/toth-pedidos-window.ts.
 *
 * A janela é a única parte da sincronização de pedidos que dá para provar sem o
 * ERP no ar — e é a que decide se a chamada traz dados ou traz vazio com cara
 * de "não houve vendas". Por isso é aqui que a cobertura vive.
 */
import { describe, it, expect } from "vitest";
import {
  resolvePedidosWindow,
  buildPedidosBody,
  chunkDocumentos,
  isIsoDate,
  JANELA_PADRAO_DIAS,
  JANELA_MAXIMA_DIAS,
} from "../../supabase/functions/_shared/erp/toth-pedidos-window";

/** 15h em Brasília — bem dentro do dia, sem ambiguidade de fuso. */
const AGORA = new Date("2026-08-28T18:00:00.000Z");

describe("resolvePedidosWindow", () => {
  it("sem configuração, usa a janela padrão terminando hoje", () => {
    const w = resolvePedidosWindow({ agora: AGORA });
    expect(w.dataFinal).toBe("2026-08-28");
    expect(w.origem).toBe("janela");
    expect(w.dias).toBe(JANELA_PADRAO_DIAS + 1);
  });

  it("respeita a janela configurada pela org", () => {
    const w = resolvePedidosWindow({ janelaDias: 30, agora: AGORA });
    expect(w.dataInicial).toBe("2026-07-29");
    expect(w.dataFinal).toBe("2026-08-28");
  });

  it("o piso de backfill vence a janela", () => {
    const w = resolvePedidosWindow({
      janelaDias: 30,
      dataInicialConfigurada: "2025-01-01",
      agora: AGORA,
    });
    expect(w.dataInicial).toBe("2025-01-01");
    expect(w.origem).toBe("backfill");
  });

  it("o corpo da requisição vence tudo", () => {
    const w = resolvePedidosWindow({
      janelaDias: 30,
      dataInicialConfigurada: "2025-01-01",
      dataInicial: "2026-07-01",
      dataFinal: "2026-07-31",
      agora: AGORA,
    });
    expect(w).toMatchObject({ dataInicial: "2026-07-01", dataFinal: "2026-07-31", origem: "corpo" });
    expect(w.dias).toBe(31);
  });

  it("ignora data mal formada e cai na regra seguinte", () => {
    const w = resolvePedidosWindow({ dataInicial: "31/07/2026", janelaDias: 10, agora: AGORA });
    expect(w.origem).toBe("janela");
    expect(w.dataInicial).toBe("2026-08-18");
  });

  it("colapsa intervalo invertido em vez de devolver zero pedido calado", () => {
    const w = resolvePedidosWindow({
      dataInicial: "2026-09-01",
      dataFinal: "2026-08-01",
      agora: AGORA,
    });
    expect(w.dataInicial).toBe("2026-08-01");
    expect(w.dataFinal).toBe("2026-08-01");
    expect(w.dias).toBe(1);
  });

  it("limita a janela ao teto, para varredura de anos ser pedida e não acidental", () => {
    const w = resolvePedidosWindow({ janelaDias: 999_999, agora: AGORA });
    expect(w.dias).toBe(JANELA_MAXIMA_DIAS + 1);
  });

  it("janela zero ou negativa cai no padrão, não em intervalo vazio", () => {
    expect(resolvePedidosWindow({ janelaDias: 0, agora: AGORA }).dias).toBe(JANELA_PADRAO_DIAS + 1);
    expect(resolvePedidosWindow({ janelaDias: -5, agora: AGORA }).dias).toBe(
      JANELA_PADRAO_DIAS + 1,
    );
  });

  it("às 22h de Brasília o dia ainda é hoje, não amanhã", () => {
    // 2026-08-28T22:30 BRT = 2026-08-29T01:30 UTC. Sem o deslocamento, a janela
    // terminaria no dia 29 e deslizaria um dia a cada execução noturna.
    const w = resolvePedidosWindow({ agora: new Date("2026-08-29T01:30:00.000Z") });
    expect(w.dataFinal).toBe("2026-08-28");
  });
});

describe("isIsoDate", () => {
  it("aceita aaaa-mm-dd real", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
  });

  it("recusa data que a regex aceitaria mas o calendário não", () => {
    expect(isIsoDate("2026-13-40")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
  });

  it("recusa outros formatos", () => {
    expect(isIsoDate("28/08/2026")).toBe(false);
    expect(isIsoDate("2026-08-28T00:00:00Z")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("buildPedidosBody", () => {
  const window = resolvePedidosWindow({ dataInicial: "2025-01-01", dataFinal: "2026-07-31" });

  it("monta o corpo com janela e página", () => {
    expect(buildPedidosBody({ window, page: 3 })).toEqual({
      dataInicial: "2025-01-01",
      dataFinal: "2026-07-31",
      page: 3,
    });
  });

  it("OMITE numeroInscricao quando não há documento — lista vazia devolveria zero pedido", () => {
    const body = buildPedidosBody({ window, page: 1, numeroInscricao: [] });
    expect(body).not.toHaveProperty("numeroInscricao");
  });

  it("normaliza os documentos para dígitos", () => {
    const body = buildPedidosBody({
      window,
      page: 1,
      numeroInscricao: ["44.750.277/0001-07", "06320524000146"],
    });
    expect(body.numeroInscricao).toEqual(["44750277000107", "06320524000146"]);
  });

  it("descarta entrada sem dígito nenhum", () => {
    const body = buildPedidosBody({ window, page: 1, numeroInscricao: ["", "  ", "-"] });
    expect(body).not.toHaveProperty("numeroInscricao");
  });
});

describe("chunkDocumentos", () => {
  it("parte em lotes do tamanho pedido", () => {
    const docs = Array.from({ length: 120 }, (_, i) => String(i));
    const lotes = chunkDocumentos(docs, 50);
    expect(lotes.map((l) => l.length)).toEqual([50, 50, 20]);
  });

  it("lista vazia não vira lote vazio", () => {
    expect(chunkDocumentos([], 50)).toEqual([]);
  });
});
