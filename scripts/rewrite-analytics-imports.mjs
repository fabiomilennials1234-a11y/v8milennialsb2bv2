#!/usr/bin/env node
/**
 * Slice 12 analytics — rewrites imports após mover componentes/hooks/pages
 * pra src/modules/analytics/.
 *
 * Regras (mantém o alias `@/modules/analytics/...` em todas as referencias,
 * inclusive dentro do proprio modulo, pra consistencia com slices anteriores):
 *
 * - @/components/<bucket>/...  -> @/modules/analytics/components/<bucket>/...
 *   buckets: analytics (com subpastas charts/sections/tabs), dashboard,
 *            dashboard-outbound, performance, tv
 *
 * - @/hooks/<analytics-hook>   -> @/modules/analytics/hooks/<analytics-hook>
 *   (lista hardcoded abaixo — 18 hooks)
 *
 * - @/pages/<analytics-page>   -> @/modules/analytics/pages/<analytics-page>
 *   pages: Dashboard, DashboardOutbound, Performance, TVDashboard
 *
 * - "./pages/<analytics-page>" -> "@/modules/analytics/pages/<analytics-page>"
 *   (App.tsx usa relativo)
 *
 * - "./DashboardOutbound" (relative dentro de pages/) -> "@/modules/analytics/pages/DashboardOutbound"
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["src", "tests"];
const EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;

const COMPONENT_BUCKETS = [
  "analytics",
  "dashboard",
  "dashboard-outbound",
  "performance",
  "tv",
];

const ANALYTICS_HOOKS = new Set([
  "useAnalytics",
  "useAnalyticsComercial",
  "useAnalyticsEngajamento",
  "useAnalyticsFilters",
  "useAnalyticsFinanceiro",
  "useAnalyticsOverview",
  "useAnalyticsPipesFunis",
  "useAnalyticsUtms",
  "useCohortAnalysis",
  "useDashboardMetrics",
  "useExchangeRates",
  "useMktByOrigin",
  "useMktOriginConfig",
  "useOutboundMetrics",
  "useSegmentBenchmark",
  "useSplitAbMetrics",
  "useTVDashboardData",
  "useTVKPIs",
]);

const ANALYTICS_PAGES = new Set([
  "Dashboard",
  "DashboardOutbound",
  "Performance",
  "TVDashboard",
]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      walk(p, files);
    } else if (EXT.test(entry)) {
      files.push(p);
    }
  }
  return files;
}

function rewriteImports(src) {
  let out = src;
  let changes = 0;

  // 1) @/components/<bucket>/... (qualquer profundidade, ex.: analytics/charts/X)
  const bucketRegex = new RegExp(
    `(['"])@/components/(${COMPONENT_BUCKETS.join("|")})/([^'"]+)\\1`,
    "g",
  );
  out = out.replace(bucketRegex, (m, q, bucket, rest) => {
    changes++;
    return `${q}@/modules/analytics/components/${bucket}/${rest}${q}`;
  });

  // 2) @/hooks/<analytics-hook>(/<rest>)?
  out = out.replace(
    /(['"])@\/hooks\/([A-Za-z0-9_]+)(\/[^'"]*)?\1/g,
    (m, q, hook, rest) => {
      if (!ANALYTICS_HOOKS.has(hook)) return m;
      changes++;
      return `${q}@/modules/analytics/hooks/${hook}${rest ?? ""}${q}`;
    },
  );

  // 3) @/pages/<analytics-page>
  out = out.replace(
    /(['"])@\/pages\/([A-Za-z0-9_]+)\1/g,
    (m, q, page) => {
      if (!ANALYTICS_PAGES.has(page)) return m;
      changes++;
      return `${q}@/modules/analytics/pages/${page}${q}`;
    },
  );

  // 4) "./pages/<analytics-page>" (App.tsx usa relativo)
  out = out.replace(
    /(['"])\.\/pages\/([A-Za-z0-9_]+)\1/g,
    (m, q, page) => {
      if (!ANALYTICS_PAGES.has(page)) return m;
      changes++;
      return `${q}@/modules/analytics/pages/${page}${q}`;
    },
  );

  // Nota: Dashboard.tsx importa "./DashboardOutbound" — após mover ambos para
  // src/modules/analytics/pages/, o relativo continua válido (mesmo diretório).
  // Não reescrevemos pra evitar matchear arquivos não-analytics homônimos.

  return { out, changes };
}

const allFiles = [];
for (const d of TARGET_DIRS) walk(join(ROOT, d), allFiles);

let totalChanges = 0;
let touched = 0;
for (const f of allFiles) {
  const src = readFileSync(f, "utf8");
  const { out, changes } = rewriteImports(src);
  if (changes > 0 && out !== src) {
    writeFileSync(f, out);
    touched++;
    totalChanges += changes;
    process.stdout.write(
      `updated ${f.replace(ROOT + "\\", "").replace(/\\/g, "/")} (${changes})\n`,
    );
  }
}

process.stdout.write(`\nTOTAL: ${touched} files, ${totalChanges} import rewrites\n`);
