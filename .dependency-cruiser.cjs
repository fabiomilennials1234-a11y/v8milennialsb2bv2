/**
 * Dependency-cruiser config — Torque CRM Modularização (slice 1).
 *
 * Garante:
 *  1. Sem ciclos de dependência em `src/` (regra `no-circular`).
 *  2. Sem imports cross-module através de internals (`module-internals-private`)
 *     uma vez que módulos existam em `src/modules/<bc>/` (slice 2+).
 *
 * Modo atual: error em violações inter-módulo e ciclos (flip Fase 2 enforcement real).
 * Gate efetivo via ratchet (`scripts/dep-cruise-ratchet.js`) que compara contra
 * `.dependency-cruiser-baseline.json` — falha apenas em violations NOVAS.
 *
 * Ver: .specs/features/modularizacao/SPEC.md
 *      Obsidian/.../10 — Remodelagem/02-solucao/boundary-enforcement.md
 *      Obsidian/.../10 — Remodelagem/04-execucao/roadmap-pos-modularizacao/fase-2-enforcement-real.md
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Ciclos entre módulos / arquivos quebram tree-shaking e tornam refactor "
        + "frágil. Resolver via extração de tipo compartilhado ou inversão de dependência. "
        + "Só conta ciclo 100% estático: `viaOnly` exige que NENHUMA aresta do ciclo "
        + "seja `import()` dinâmico (esses caem em `no-circular-dynamic`).",
      from: {},
      to: {
        circular: true,
        viaOnly: { dependencyTypesNot: ["dynamic-import"] },
      },
    },
    {
      name: "no-circular-dynamic",
      severity: "warn",
      comment:
        "Ciclo que só se fecha por `import()` dinâmico — tipicamente prefetch de rota "
        + "ou `React.lazy`. NÃO é ciclo em tempo de carga: o módulo dinâmico só é "
        + "avaliado quando a Promise resolve, então não há inicialização circular nem "
        + "quebra de tree-shaking (o bundler já separa em chunk). Fica em `warn` de "
        + "propósito: sinaliza acoplamento entre módulos sem reprovar o padrão de "
        + "code-splitting que o projeto usa por decisão de arquitetura. Se um destes "
        + "aparecer sem envolver rota/lazy, trate como acoplamento de verdade.",
      from: {},
      to: {
        circular: true,
        via: { dependencyTypes: ["dynamic-import"] },
      },
    },
    {
      name: "module-internals-private",
      severity: "error",
      comment:
        "Imports entre módulos devem passar pela API pública (`src/modules/<bc>/index.ts`). "
        + "Importar internals (subpastas) cria acoplamento que o monolito modular existe pra evitar.",
      from: {
        path: "^src/modules/([^/]+)/",
      },
      to: {
        path: "^src/modules/(?!\\1)([^/]+)/(?!index\\.ts$|index$)",
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "Arquivos órfãos (sem importadores) acumulam débito e mascaram código morto. "
        + "Validar caso a caso — pode ser entry point legítimo, mock, ou candidato a deletar.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$",
          "\\.d\\.ts$",
          "(^|/)tsconfig\\.json$",
          "(^|/)package\\.json$",
          "\\.config\\.(js|cjs|mjs|ts)$",
          "^src/main\\.tsx$",
          "^src/vite-env\\.d\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules"],
    },
    exclude: {
      path: [
        "(^|/)node_modules/",
        "^dist/",
        "^coverage/",
        "^playwright-report/",
        "^test-results/",
        "^supabase/",
        "^scripts/",
        "^tests/",
        "^src/integrations/supabase/types\\.ts$",
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["main", "types"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
