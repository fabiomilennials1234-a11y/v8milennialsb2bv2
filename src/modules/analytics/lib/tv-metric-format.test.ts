import { describe, it, expect } from "vitest";
import {
  formatMetricValue,
  resolveHeadValue,
  isEmptyReason,
  typeScaleForWeight,
  usesHeroTypography,
  EM_DASH,
} from "./tv-metric-format";

describe("tv-metric-format (spec §2.6b, §5.1/§5.2)", () => {
  it("REGRA DURA: ausência de dado é travessão, NUNCA 0", () => {
    expect(formatMetricValue(null, "integer")).toBe(EM_DASH);
    expect(formatMetricValue(undefined, "currency_brl")).toBe(EM_DASH);
    expect(formatMetricValue(NaN, "percent_1")).toBe(EM_DASH);
    // e zero legítimo continua sendo zero — é um dado.
    expect(formatMetricValue(0, "integer")).toBe("0");
  });

  it("AC #7: empty_reason vence o número — 0 com no_rows vira ausência (—)", () => {
    // Bug do QA (Finding #7): leaf de contagem sem registros chega como
    // value:0 + empty_reason:'no_rows'; mostrar "0" é exibir ausência como dado.
    expect(resolveHeadValue(0, "no_rows")).toBeNull();
    expect(resolveHeadValue(0, "never_existed")).toBeNull();
    expect(formatMetricValue(resolveHeadValue(0, "no_rows"), "integer")).toBe(EM_DASH);
    expect(formatMetricValue(resolveHeadValue(0, "no_rows"), "currency_brl")).toBe(EM_DASH);

    // Zero LEGÍTIMO (base com linhas somando zero) vem sem empty_reason → é 0.
    expect(resolveHeadValue(0, null)).toBe(0);
    expect(formatMetricValue(resolveHeadValue(0, null), "integer")).toBe("0");

    // Valor real com empty_reason nunca deveria coexistir, mas se vier, o dado ganha.
    expect(resolveHeadValue(4000, null)).toBe(4000);

    expect(isEmptyReason("no_rows")).toBe(true);
    expect(isEmptyReason(null)).toBe(false);
  });

  it("moeda encurta para a parede a partir de mil/milhão", () => {
    expect(formatMetricValue(1_312_840.55, "currency_brl")).toBe("R$ 1,3 mi");
    expect(formatMetricValue(412_000, "currency_brl")).toBe("R$ 412 mil");
    expect(formatMetricValue(850, "currency_brl")).toContain("850");
  });

  it("percentual com 1 casa; razão com 2", () => {
    expect(formatMetricValue(66.666, "percent_1")).toBe("66,7%");
    expect(formatMetricValue(1.5, "ratio_2")).toBe("1,50");
  });

  it("duração usa no máximo dois degraus", () => {
    expect(formatMetricValue(3 * 86400 + 4 * 3600, "duration_human")).toBe("3d 4h");
    expect(formatMetricValue(5400, "duration_human")).toBe("1h 30m");
    expect(formatMetricValue(90, "duration_human")).toBe("1m");
  });

  it("formato desconhecido cai em inteiro, não quebra a parede", () => {
    expect(formatMetricValue(1234, "nao_existe")).toBe("1.234");
  });

  it("peso amarra a escala tipográfica", () => {
    expect(typeScaleForWeight("hero")).toBe("var(--tv-hero)");
    expect(typeScaleForWeight("primary")).toBe("var(--tv-value)");
    expect(typeScaleForWeight("secondary")).toBe("var(--tv-value-sm)");
    expect(typeScaleForWeight(undefined)).toBe("var(--tv-value-sm)");
  });

  it("só a TIPOGRAFIA hero conta como hero (§6.4)", () => {
    expect(usesHeroTypography("hero")).toBe(true);
    // Bloco grande em células, mas com tipo --tv-value (Thermometer 3×4): NÃO é hero.
    expect(usesHeroTypography("primary")).toBe(false);
  });
});
