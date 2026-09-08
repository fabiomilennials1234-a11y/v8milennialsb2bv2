// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import templates from "./metrics-studio-templates.json";
import { projectStudioWindows } from "./metrics-studio-projection";
import type { StudioWindow } from "./metrics-studio-window";

describe("templates compartilhados do Estúdio", () => {
  it("os quatro templates da UI são exatamente os semeados no banco", () => {
    const sql = readFileSync("supabase/migrations/20271017113742_dashboards_viram_templates.sql", "utf8");
    const payload = sql.match(/\$templates\$([\s\S]*?)\$templates\$/)?.[1];
    expect(payload).toBeTruthy();
    expect(JSON.parse(payload!)).toEqual(templates);
    expect(templates.map((template) => template.key)).toEqual(["visao-geral", "performance", "saude", "mapa"]);
  });
  it("todos os cards semeados existem no registry e têm id único por painel", () => {
    const registry = readFileSync("src/modules/analytics/lib/metrics-studio-fixed-cards.ts", "utf8");
    for (const template of templates) {
      expect(new Set(template.layout.map((win) => win.id)).size).toBe(template.layout.length);
      for (const win of template.layout) expect(registry).toContain(`"${win.fixo}":`);
    }
  });
  it("a projeção móvel não altera nem perde janelas do layout salvo", () => {
    const original = structuredClone(templates[0].layout) as StudioWindow[];
    const projected = projectStudioWindows(original, 360);
    expect(projected).toHaveLength(original.length);
    expect(projected.every((win) => win.x + win.w <= 360)).toBe(true);
    expect(original).toEqual(templates[0].layout);
    expect(projected.slice(1).every((win, index) => win.y >= projected[index].y + projected[index].h)).toBe(true);
    expect(projectStudioWindows(original, 1400)).toBe(original);
  });
});
