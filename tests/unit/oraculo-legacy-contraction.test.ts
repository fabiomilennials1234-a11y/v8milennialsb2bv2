import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const retiredFiles = [
  "src/modules/analytics/components/dashboard/OraculoChat.tsx",
  "src/modules/analytics/components/dashboard/OraculoFloatingButton.tsx",
  "src/modules/copilot/components/oraculo/OraculoComercial.tsx",
  "src/modules/copilot/hooks/useOraculoChat.ts",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

describe("contração do Oráculo legado", () => {
  it("não mantém componentes nem hook substituídos", () => {
    expect(retiredFiles.filter((path) => existsSync(join(root, path)))).toEqual([]);
  });

  it("não mantém consumidores do chat antigo ou do limite de três perguntas", () => {
    const forbidden = /useOraculoChat|OraculoChat|OraculoFloatingButton|check_oraculo_limit|record_oraculo_usage/;
    const offenders = ["src", "scripts"].flatMap((directory) => sourceFiles(join(root, directory)))
      .filter((path) => !path.endsWith("oraculo-legacy-contraction.test.ts"))
      // Gerado pelo Supabase CLI. Sai quando a migração chegar ao ambiente e os tipos forem regenerados.
      .filter((path) => !path.endsWith("src/integrations/supabase/types.ts"))
      .filter((path) => forbidden.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("preserva consumidor e modo de análise da TV", () => {
    const tv = readFileSync(join(root, "src/modules/analytics/components/tv/AICoachSection.tsx"), "utf8");
    const endpoint = readFileSync(join(root, "supabase/functions/oraculo-comercial/index.ts"), "utf8");
    expect(tv).toContain('mode: "tv_analysis"');
    expect(endpoint).toContain('"tv_analysis"');
    expect(endpoint).not.toContain('body.mode === "chat"');
  });

  it("mantém somente painel lateral e rota dedicada como superfícies de conversa", () => {
    const app = readFileSync(join(root, "src/App.tsx"), "utf8");
    const sidebarPanel = readFileSync(join(root, "src/modules/platform/components/layout/OraculoPanel.tsx"), "utf8");
    const briefingAdapter = readFileSync(join(root, "src/modules/analytics/components/metrics-studio/dashboard-card-adapters.tsx"), "utf8");
    expect(app).toContain('path="/oraculo"');
    expect(sidebarPanel).toContain("OraculoConversa");
    expect(briefingAdapter).toContain('navigate("/oraculo")');
  });
});
