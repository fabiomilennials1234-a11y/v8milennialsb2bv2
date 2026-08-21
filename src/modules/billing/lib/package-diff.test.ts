import { describe, it, expect } from "vitest";
import {
  LIMIT_UNLIMITED,
  countDirections,
  displayDirection,
  featureDirection,
  formatLimit,
  limitDirection,
  visibleKeys,
} from "./package-diff";

describe("limitDirection — ilimitado é TETO, não o número -1", () => {
  it("REGRESSÃO: ilimitado sobre um base finito é A MAIS", () => {
    // Comparado como número, -1 < 50000 e a proposta MAIS generosa apareceria
    // marcada como "a menos". É o mesmo erro que o delta cometeria na exibição,
    // um nível abaixo.
    expect(limitDirection(LIMIT_UNLIMITED, 50_000)).toBe("up");
  });

  it("REGRESSÃO: base ilimitado trocado por número finito é A MENOS", () => {
    expect(limitDirection(50_000, LIMIT_UNLIMITED)).toBe("down");
  });

  it("ilimitado contra ilimitado é igual", () => {
    expect(limitDirection(LIMIT_UNLIMITED, LIMIT_UNLIMITED)).toBe("same");
  });

  it("comparação normal segue valendo", () => {
    expect(limitDirection(12, 5)).toBe("up");
    expect(limitDirection(3, 5)).toBe("down");
    expect(limitDirection(5, 5)).toBe("same");
  });

  it("zero é limite legítimo, não ausência", () => {
    expect(limitDirection(0, 5)).toBe("down");
    expect(limitDirection(5, 0)).toBe("up");
  });
});

describe("featureDirection", () => {
  it("ligada sobre base desligada é concessão", () => {
    expect(featureDirection(true, false)).toBe("up");
  });
  it("desligada sobre base ligada é remoção", () => {
    expect(featureDirection(false, true)).toBe("down");
  });
  it("igual é igual, nos dois sentidos", () => {
    expect(featureDirection(true, true)).toBe("same");
    expect(featureDirection(false, false)).toBe("same");
  });
});

describe("countDirections — o contador do topo e os cards consomem o MESMO comparador", () => {
  it("conta as duas direções separadas", () => {
    const c = countDirections(["up", "up", "down", "same", "up"]);
    expect(c).toEqual({ up: 3, down: 1, total: 4 });
  });

  it("`settled` NÃO conta como diferença — voltou ao base", () => {
    // Se contasse, a linha diria "1 a mais" sobre um item que já é idêntico ao
    // plano, e a contagem discordaria do que o card mostra.
    expect(countDirections(["settled", "settled"])).toEqual({ up: 0, down: 0, total: 0 });
  });
});

describe("visibleKeys — as três regras do filtro", () => {
  const todas = ["a", "b", "c", "d", "e"];

  it("filtro desligado mostra tudo", () => {
    expect(visibleKeys(todas, new Set(["a"]), false, null)).toEqual(todas);
  });

  it("filtro ligado mostra o retrato do momento em que foi ligado", () => {
    const snap = new Set(["a", "b"]);
    expect(visibleKeys(todas, new Set(["a", "b"]), true, snap)).toEqual(["a", "b"]);
  });

  it("R1: item que VOLTA ao base continua visível — nada sai debaixo do dedo", () => {
    // Snapshot tinha a e b; o operador neutralizou b. b FICA.
    const snap = new Set(["a", "b"]);
    expect(visibleKeys(todas, new Set(["a"]), true, snap)).toEqual(["a", "b"]);
  });

  it("R1: neutralizar TODAS não esvazia a lista", () => {
    const snap = new Set(["a", "b"]);
    expect(visibleKeys(todas, new Set(), true, snap)).toEqual(["a", "b"]);
  });

  it("R1: diferença NOVA entra sem esperar novo retrato", () => {
    const snap = new Set(["a"]);
    expect(visibleKeys(todas, new Set(["a", "e"]), true, snap)).toEqual(["a", "e"]);
  });

  it("R2: religar o filtro tira retrato novo — é o único jeito de um item sair", () => {
    const snapVelho = new Set(["a", "b"]);
    expect(visibleKeys(todas, new Set(["a"]), true, snapVelho)).toEqual(["a", "b"]);
    // Desligou e religou: o snapshot novo é o estado corrente.
    const snapNovo = new Set(["a"]);
    expect(visibleKeys(todas, new Set(["a"]), true, snapNovo)).toEqual(["a"]);
  });

  it("GUARDA: filtro ligado com zero diferenças e sem retrato não deixa a lista vazia", () => {
    // Inalcançável pela UI (o interruptor está oculto nesse caso), mas
    // alcançável por localStorage ou deep link. Estado impossível de ALCANÇAR
    // não é estado impossível de EXISTIR.
    expect(visibleKeys(todas, new Set(), true, null)).toEqual(todas);
  });
});

describe("displayDirection", () => {
  it("item que voltou ao base vira `settled` com o filtro ligado", () => {
    expect(displayDirection("b", "same", true, new Set(["b"]))).toBe("settled");
  });

  it("com o filtro DESLIGADO não existe `settled` — não há retrato a respeitar", () => {
    expect(displayDirection("b", "same", false, new Set(["b"]))).toBe("same");
  });

  it("quem nunca foi diferença não vira `settled`", () => {
    expect(displayDirection("z", "same", true, new Set(["b"]))).toBe("same");
  });

  it("diferença viva passa intacta", () => {
    expect(displayDirection("a", "up", true, new Set(["a"]))).toBe("up");
    expect(displayDirection("a", "down", true, new Set())).toBe("down");
  });
});

describe("formatLimit", () => {
  it("-1 é Ilimitado, e não o número -1", () => {
    expect(formatLimit(LIMIT_UNLIMITED)).toBe("Ilimitado");
  });
  it("número grande vem com separador de milhar", () => {
    expect(formatLimit(50_000)).toBe("50.000");
  });
});
