import { describe, it, expect } from "vitest";
import {
  generateSparklinePath,
  deriveKPIDelta,
  formatRevenueData,
} from "../../src/lib/analytics-helpers";

describe("generateSparklinePath", () => {
  it("generates SVG path from numeric array", () => {
    const path = generateSparklinePath([10, 20, 15, 30, 25], 100, 40);
    expect(path).toMatch(/^M\d/);
    expect(path).toContain("L");
  });

  it("starts at M0 and ends at width", () => {
    const path = generateSparklinePath([0, 50, 100], 80, 30);
    expect(path).toMatch(/^M0 /);
    expect(path).toContain("L80 ");
  });

  it("returns empty string for less than 2 points", () => {
    expect(generateSparklinePath([], 100, 40)).toBe("");
    expect(generateSparklinePath([5], 100, 40)).toBe("");
  });

  it("maps min value to bottom and max to top", () => {
    const path = generateSparklinePath([0, 100], 100, 40);
    expect(path).toBe("M0 40 L100 0");
  });
});

describe("deriveKPIDelta", () => {
  it("computes positive delta percentage", () => {
    const d = deriveKPIDelta(84200, 75000);
    expect(d.delta).toBe(12);
    expect(d.direction).toBe("up");
  });

  it("computes negative delta percentage", () => {
    const d = deriveKPIDelta(60000, 75000);
    expect(d.delta).toBe(20);
    expect(d.direction).toBe("down");
  });

  it("returns zero delta when values equal", () => {
    const d = deriveKPIDelta(100, 100);
    expect(d.delta).toBe(0);
    expect(d.direction).toBe("neutral");
  });

  it("handles zero previous (no comparison)", () => {
    const d = deriveKPIDelta(500, 0);
    expect(d.direction).toBe("neutral");
  });
});

describe("formatRevenueData", () => {
  it("formats YYYY-MM to pt-BR month abbreviation", () => {
    const data = formatRevenueData([
      { month: "2026-01", approved: 5000, pending: 1200 },
      { month: "2026-02", approved: 7000, pending: 800 },
    ]);
    expect(data[0].month).toBe("jan");
    expect(data[1].month).toBe("fev");
  });

  it("preserves numeric values", () => {
    const data = formatRevenueData([
      { month: "2026-03", approved: 12500, pending: 3200 },
    ]);
    expect(data[0].approved).toBe(12500);
    expect(data[0].pending).toBe(3200);
  });

  it("returns empty array for empty input", () => {
    expect(formatRevenueData([])).toEqual([]);
  });
});
