import { describe, it, expect } from "vitest";
import {
  formatBRL,
  formatSignedBRL,
  formatPercent,
  formatInt,
  formatCompras,
  formatMes,
  horizonteRange,
  horizonteMeta,
  formatPeriodRange,
  HORIZONTES,
} from "@/modules/identity/master/components/insights/lib/format";
import {
  monotoneCubicPath,
  buildJCurveGeometry,
  type Pt,
} from "@/modules/identity/master/components/insights/lib/jcurve-geometry";
import type {
  PaybackCurvePoint,
  PaybackCurveMarks,
} from "@/modules/identity/master/lib/unit-economics";

describe("insights format helpers", () => {
  it("formats BRL with no cents by default and cents when asked", () => {
    expect(formatBRL(4560)).toMatch(/R\$\s?4\.560/);
    expect(formatBRL(1234.5, { cents: true })).toMatch(/R\$\s?1\.234,50/);
  });

  it("prefixes a minus sign for negative cash (curve bottom)", () => {
    expect(formatSignedBRL(-1500)).toMatch(/^−R\$/);
    expect(formatSignedBRL(1500)).not.toMatch(/^−/);
  });

  it("formats percent and integers pt-BR", () => {
    expect(formatPercent(10)).toBe("10 %");
    expect(formatPercent(1.5)).toBe("1,5 %");
    expect(formatInt(30)).toBe("30");
  });

  it("formats compras with one decimal and mes labels", () => {
    expect(formatCompras(1.25)).toBe("1,3");
    expect(formatMes(5.4)).toBe("mês 5");
    expect(formatMes(null)).toBe("—");
  });

  it("coerces non-finite inputs to 0 (never NaN)", () => {
    expect(formatBRL(Number.NaN)).toMatch(/R\$\s?0/);
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("0 %");
  });

  it("maps horizonte → calendar-period window (current month/quarter/year to date)", () => {
    expect(HORIZONTES).toHaveLength(3);
    expect(horizonteMeta("trimestral").curveMeses).toBe(18);

    // ref fixo no meio do ano (26/06/2026) p/ determinismo.
    const ref = new Date(2026, 5, 26); // mês 0-indexado: 5 = junho

    expect(horizonteRange("mensal", ref)).toEqual({
      start: "2026-06-01",
      end: "2026-06-26",
    });
    expect(horizonteRange("trimestral", ref)).toEqual({
      start: "2026-04-01", // Q2 começa em abril
      end: "2026-06-26",
    });
    expect(horizonteRange("anual", ref)).toEqual({
      start: "2026-01-01",
      end: "2026-06-26",
    });
  });

  it("defaults horizonteRange ref to today and yields ISO dates with start <= end", () => {
    const { start, end } = horizonteRange("mensal");
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(start <= end).toBe(true); // no 1º dia do mês start === end
  });

  it("formats the observed period as an explicit pt-BR range", () => {
    expect(formatPeriodRange("2026-06-01", "2026-06-26")).toBe("01/06 – 26/06/2026");
    // ano diferente → ambas as datas mostram o ano
    expect(formatPeriodRange("2025-12-15", "2026-01-03")).toBe(
      "15/12/2025 – 03/01/2026",
    );
  });
});

describe("monotoneCubicPath", () => {
  it("returns empty for no points and a moveto for one", () => {
    expect(monotoneCubicPath([])).toBe("");
    expect(monotoneCubicPath([{ x: 1, y: 2 }])).toBe("M1,2");
  });

  it("emits a straight line for two points", () => {
    expect(monotoneCubicPath([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe("M0,0L10,5");
  });

  it("emits cubic segments for 3+ points starting with a moveto", () => {
    const pts: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: -8 },
      { x: 20, y: 4 },
      { x: 30, y: 12 },
    ];
    const d = monotoneCubicPath(pts);
    expect(d.startsWith("M0,0")).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(3);
    expect(d).not.toContain("NaN");
  });
});

describe("buildJCurveGeometry", () => {
  const points: PaybackCurvePoint[] = [
    { mes: 0, valor: 0 },
    { mes: 1, valor: -100 },
    { mes: 2, valor: -60 },
    { mes: 3, valor: 0 },
    { mes: 4, valor: 80 },
  ];
  const marks: PaybackCurveMarks = {
    maxCashConsumed: -100,
    maxCashMes: 1,
    breakEvenMes: 3,
    selfFundingMes: 3,
    horizonteMeses: 4,
  };

  it("computes scales, paths and markers in pixel space", () => {
    const geo = buildJCurveGeometry({ points, marks, width: 800, height: 400 });
    expect(geo.linePath.startsWith("M")).toBe(true);
    expect(geo.areaPath.endsWith("Z")).toBe(true);
    // zero ruler sits inside the plot box
    expect(geo.zeroY).toBeGreaterThan(geo.plotTop);
    expect(geo.zeroY).toBeLessThan(geo.plotBottom);
    // bottom marker = the minimum (negative) point
    expect(geo.bottomMark?.valor).toBe(-100);
    expect(geo.breakEvenMark?.mes).toBe(3);
  });

  it("includes ghost points in the shared domain when provided", () => {
    const ghost: PaybackCurvePoint[] = [
      { mes: 0, valor: 0 },
      { mes: 4, valor: 200 },
    ];
    const geo = buildJCurveGeometry({
      points,
      marks,
      width: 800,
      height: 400,
      ghostPoints: ghost,
    });
    expect(geo.ghostPath).not.toBeNull();
    // larger ghost peak (200) must compress the primary peak (80) below the top
    expect(geo.sy(80)).toBeGreaterThan(geo.plotTop);
  });
});
