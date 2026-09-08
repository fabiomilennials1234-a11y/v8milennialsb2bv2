// @vitest-environment node
import { describe, expect, it } from "vitest";
import templates from "./metrics-studio-templates.json";
import type { StudioWindow } from "./metrics-studio-window";
import { projectStudioWindows } from "./metrics-studio-projection";

describe("templates ocupam a largura disponível", () => {
  for (const template of templates) {
    it(`${template.nome}: expande sem modificar o layout salvo`, () => {
      const original = structuredClone(template.layout) as StudioWindow[];
      const projected = projectStudioWindows(original, 1800, true);
      expect(Math.min(...projected.map(w => w.x))).toBe(16);
      expect(Math.max(...projected.map(w => w.x + w.w))).toBeCloseTo(1784);
      expect(projected.map(w => [w.id, w.y, w.h])).toEqual(original.map(w => [w.id, w.y, w.h]));
      expect(original).toEqual(template.layout);
      expect(projectStudioWindows(original, 1800)).toBe(original);
    });
    it(`${template.nome}: empilha no celular sem overflow`, () => {
      const projected = projectStudioWindows(template.layout as StudioWindow[], 350, true);
      expect(projected.every(w => w.x === 16 && w.w === 318)).toBe(true);
      expect(projected.slice(1).every((w,i) => w.y >= projected[i].y + projected[i].h + 16)).toBe(true);
    });
  }
  it("ignora canvas ainda não medido e painel vazio", () => {
    expect(projectStudioWindows([], 1800, true)).toEqual([]);
    const windows = templates[0].layout as StudioWindow[];
    expect(projectStudioWindows(windows, 0, true)).toBe(windows);
  });
});
