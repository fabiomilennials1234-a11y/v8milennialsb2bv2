/**
 * Dependency-cruiser config — Torque CRM Modularização (slice 1).
 *
 * Garante:
 *  1. Sem ciclos de dependência em `src/` (regra `no-circular`).
 *  2. Sem imports cross-module através de internals (`module-internals-private`)
 *     uma vez que módulos existam em `src/modules/<bc>/` (slice 2+).
 *
 * Modo atual: warn em violações inter-módulo (ainda não há módulos populados).
 * Flip para error em slice 17 quando estrutura estiver consolidada.
 *
 * Ver: .specs/features/modularizacao/SPEC.md
 *      Obsidian/.../10 — Remodelagem/02-solucao/boundary-enforcement.md
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      // Warn-only inicial — 13 ciclos pré-existentes (ver `npm run lint:deps`).
      // Flip para `error` em slice 17 após cleanup dos ciclos existentes (issue separada).
      severity: "warn",
      comment:
        "Ciclos entre módulos / arquivos quebram tree-shaking e tornam refactor "
        + "frágil. Resolver via extração de tipo compartilhado ou inversão de dependência.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "module-internals-private",
      severity: "warn",
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
