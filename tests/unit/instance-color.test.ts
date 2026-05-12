/**
 * instanceColor — hash determinístico de instance_id → HSL hue.
 * Cobre: determinismo, distinção, formato, não-crash em string vazia.
 */
import { describe, it, expect } from "vitest";
import { instanceColor } from "@/components/chat/bubble/utils/instanceColor";

describe("instanceColor", () => {
  it("é determinístico — mesmo id → mesma cor", () => {
    const a1 = instanceColor("550e8400-e29b-41d4-a716-446655440000");
    const a2 = instanceColor("550e8400-e29b-41d4-a716-446655440000");
    expect(a1).toBe(a2);
  });

  it("ids distintos produzem cores distintas (alta probabilidade)", () => {
    const c1 = instanceColor("instance-alpha");
    const c2 = instanceColor("instance-beta");
    const c3 = instanceColor("instance-gamma");
    expect(c1).not.toBe(c2);
    expect(c2).not.toBe(c3);
    expect(c1).not.toBe(c3);
  });

  it("formato hsl(N 70% 55%) com N inteiro em [0, 359]", () => {
    const samples = ["a", "abc", "uuid-1234", "x".repeat(36)];
    for (const id of samples) {
      const out = instanceColor(id);
      const match = out.match(/^hsl\((\d+) 70% 55%\)$/);
      expect(match).not.toBeNull();
      const hue = Number(match![1]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(359);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });

  it("string vazia não crasha e retorna formato válido", () => {
    const out = instanceColor("");
    expect(out).toMatch(/^hsl\(\d+ 70% 55%\)$/);
  });

  it("hue resultante é estável após múltiplas chamadas", () => {
    const calls = Array.from({ length: 20 }, () => instanceColor("repeat-test"));
    const unique = new Set(calls);
    expect(unique.size).toBe(1);
  });
});
