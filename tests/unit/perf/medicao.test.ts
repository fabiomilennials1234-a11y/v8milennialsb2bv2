import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Dublês ───────────────────────────────────────────────
const trackLote = vi.fn();
const acompanharSessaoParaLote = vi.fn();
vi.mock("@/lib/analytics", () => ({
  trackLote: (...a: unknown[]) => trackLote(...a),
  acompanharSessaoParaLote: () => acompanharSessaoParaLote(),
}));

let sessao = "sessao-fixa";
vi.mock("@/core/trace/request-trace", () => ({ getSessionId: () => sessao }));

type Cb = (m: Record<string, unknown>) => void;
const vitais: Record<string, Cb> = {};
vi.mock("web-vitals", () => ({
  onLCP: (cb: Cb) => (vitais.LCP = cb),
  onINP: (cb: Cb) => (vitais.INP = cb),
  onCLS: (cb: Cb) => (vitais.CLS = cb),
  onFCP: (cb: Cb) => (vitais.FCP = cb),
  onTTFB: (cb: Cb) => (vitais.TTFB = cb),
}));

import {
  AMOSTRA_PADRAO,
  CHAVES_PERMITIDAS,
  calcularUtil,
  definirOrgDaMedicao,
  iniciarMedicao,
  marcarInicioNavegacao,
  registrarUtil,
  sorteioDaSessao,
  __resetarMedicaoParaTestes,
} from "@/core/perf/medicao";

/** Primeira sessão cujo sorteio cai dentro (ou fora) da amostra. */
function sessaoQue(entra: boolean, amostra = 0.5): string {
  for (let i = 0; i < 10_000; i++) {
    const id = `s-${i}`;
    if ((sorteioDaSessao(id) < amostra) === entra) return id;
  }
  throw new Error("sem sessão");
}

function esconderAba() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("core/perf/medicao", () => {
  beforeEach(() => {
    trackLote.mockReset();
    __resetarMedicaoParaTestes();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("amostra padrão é 0.5 (constante por sessão)", () => {
    expect(AMOSTRA_PADRAO).toBe(0.5);
  });

  it("sorteio é estável por sessão e cai em [0,1)", () => {
    const a = sorteioDaSessao("abc");
    expect(sorteioDaSessao("abc")).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    // distribuição razoável: ~metade de 2000 sessões entra em 0.5
    let dentro = 0;
    for (let i = 0; i < 2000; i++) if (sorteioDaSessao(`id-${i}`) < 0.5) dentro++;
    expect(dentro).toBeGreaterThan(800);
    expect(dentro).toBeLessThan(1200);
  });

  it("snapshot das chaves de metadata permitidas (PII)", () => {
    expect(CHAVES_PERMITIDAS).toMatchInlineSnapshot(`
      {
        "perf_util": [
          "tela",
          "ms",
          "origem",
          "amostra",
          "v",
        ],
        "web_vital": [
          "nome",
          "valor",
          "avaliacao",
          "tipo_navegacao",
          "tela",
        ],
      }
    `);
  });

  it("acumula em memória e grava em LOTE só quando a aba esconde", () => {
    sessao = sessaoQue(true);
    iniciarMedicao({ amostra: 0.5 });
    definirOrgDaMedicao("org-1");
    registrarUtil("funil", 412.6, "navegacao");
    registrarUtil("ficha_lead", 90, "navegacao");
    expect(trackLote).not.toHaveBeenCalled();

    esconderAba();

    expect(trackLote).toHaveBeenCalledTimes(1);
    const lote = trackLote.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(lote).toHaveLength(2);
    expect(lote[0]).toEqual({
      event: "perf_util",
      organizationId: "org-1",
      metadata: { tela: "funil", ms: 413, origem: "navegacao", amostra: 0.5, v: 1 },
    });
    // entity_id sempre nulo: nada de entityId/entityType no evento
    for (const e of lote) {
      expect(e).not.toHaveProperty("entityId");
      expect(Object.keys(e.metadata as object).every((k) => CHAVES_PERMITIDAS.perf_util.includes(k as never))).toBe(true);
    }
  });

  it("pagehide também descarrega; segunda descarga sem linhas não grava", () => {
    sessao = sessaoQue(true);
    iniciarMedicao({ amostra: 0.5 });
    definirOrgDaMedicao("org-1");
    registrarUtil("chat", 100, "carga");
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    expect(trackLote).toHaveBeenCalledTimes(1);
    // Saída da página: lote marcado `saindo` (keepalive, sem await de sessão).
    expect(trackLote.mock.calls[0][1]).toEqual({ saindo: true });
    expect(acompanharSessaoParaLote).toHaveBeenCalled();
  });

  it("linha sem org é descartada", () => {
    sessao = sessaoQue(true);
    iniciarMedicao({ amostra: 0.5 });
    registrarUtil("funil", 300, "carga");
    esconderAba();
    expect(trackLote).not.toHaveBeenCalled();
  });

  it("sessão fora da amostra não registra nada", () => {
    sessao = sessaoQue(false);
    iniciarMedicao({ amostra: 0.5 });
    definirOrgDaMedicao("org-1");
    registrarUtil("funil", 300, "carga");
    esconderAba();
    expect(trackLote).not.toHaveBeenCalled();
  });

  it("web vital vira linha com só as chaves permitidas", () => {
    sessao = sessaoQue(true);
    iniciarMedicao({ amostra: 0.5 });
    definirOrgDaMedicao("org-1");
    registrarUtil("funil", 300, "carga");
    vitais.LCP({
      name: "LCP",
      value: 1234.567,
      rating: "good",
      navigationType: "navigate",
      id: "v5-123",
      entries: [{ url: "https://x/privado?id=1" }],
      attribution: { url: "/leads/abc" },
    });
    vitais.CLS({ name: "CLS", value: 0.123456, rating: "needs-improvement", navigationType: "reload", entries: [] });
    esconderAba();
    const lote = trackLote.mock.calls[0][0] as Array<{ event: string; metadata: Record<string, unknown> }>;
    const lcp = lote.find((e) => e.event === "web_vital" && e.metadata.nome === "LCP")!;
    expect(lcp.metadata).toEqual({ nome: "LCP", valor: 1235, avaliacao: "good", tipo_navegacao: "navigate", tela: "funil" });
    const cls = lote.find((e) => e.metadata.nome === "CLS")!;
    expect(cls.metadata.valor).toBe(0.123);
    for (const e of lote.filter((x) => x.event === "web_vital")) {
      expect(Object.keys(e.metadata).every((k) => CHAVES_PERMITIDAS.web_vital.includes(k as never))).toBe(true);
    }
  });

  it("iniciar duas vezes não duplica ouvintes", () => {
    sessao = sessaoQue(true);
    iniciarMedicao({ amostra: 0.5 });
    iniciarMedicao({ amostra: 0.5 });
    definirOrgDaMedicao("org-1");
    registrarUtil("funil", 10, "carga");
    esconderAba();
    expect(trackLote).toHaveBeenCalledTimes(1);
  });

  it("clique simples num link interno marca o início da navegação", () => {
    sessao = sessaoQue(true);
    iniciarMedicao({ amostra: 0.5 });
    calcularUtil(10, 20); // consome a carga
    const a = document.createElement("a");
    a.href = "/funil/vendas";
    a.addEventListener("click", (e) => e.preventDefault());
    document.body.appendChild(a);
    vi.spyOn(performance, "now").mockReturnValue(3000);
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(calcularUtil(3100, 3400)).toEqual({ ms: 400, origem: "navegacao" });
    // ctrl+clique (nova aba) não é navegação desta aba
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }));
    expect(calcularUtil(3100, 3500)).toBeNull();
    a.remove();
  });

  describe("calcularUtil", () => {
    it("1ª tela útil sem navegação é carga, medida desde a origem da página", () => {
      expect(calcularUtil(500, 1800)).toEqual({ ms: 1800, origem: "carga" });
      // carga só uma vez
      expect(calcularUtil(2000, 2500)).toBeNull();
    });

    it("navegação marcada antes da montagem mede desde o clique", () => {
      calcularUtil(10, 20); // consome a carga
      vi.spyOn(performance, "now").mockReturnValue(5000);
      marcarInicioNavegacao();
      expect(calcularUtil(5100, 5600)).toEqual({ ms: 600, origem: "navegacao" });
      // marca consumida
      expect(calcularUtil(5100, 5700)).toBeNull();
    });

    it("marca posterior à montagem não pertence a esta tela", () => {
      calcularUtil(10, 20);
      vi.spyOn(performance, "now").mockReturnValue(9000);
      marcarInicioNavegacao();
      expect(calcularUtil(8000, 9500)).toBeNull();
    });

    it("marca velha (>30 s) é ignorada", () => {
      calcularUtil(10, 20);
      vi.spyOn(performance, "now").mockReturnValue(1000);
      marcarInicioNavegacao();
      expect(calcularUtil(2000, 40_000)).toBeNull();
    });

    it("carga tardia (tela montada depois de 15 s) não é carga", () => {
      expect(calcularUtil(20_000, 21_000)).toBeNull();
    });
  });
});
