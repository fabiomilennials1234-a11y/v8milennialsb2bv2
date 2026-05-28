#!/usr/bin/env node
/**
 * Slice 10 carteira — rewrites imports após mover componentes/hooks/pages
 * pra src/modules/carteira/.
 *
 * Regras:
 * - @/components/carteira/X       -> @/modules/carteira/components/client/X
 * - @/components/upsell/X         -> @/modules/carteira/components/upsell/X
 * - @/components/proposals/X      -> @/modules/carteira/components/proposal/X
 * - @/components/deals/X          -> @/modules/carteira/components/deal/X
 * - @/components/products/X       -> @/modules/carteira/components/product/X
 * - @/hooks/<carteira-hook>       -> @/modules/carteira/hooks/<carteira-hook>
 *
 * Dentro de src/modules/carteira/, @/modules/carteira/hooks/X vira ./hooks/X
 * (ou ../../hooks/X se o arquivo já está em subpasta). Mas como
 * eslint-plugin-boundaries (warn-only) e TS resolvem aliases sem problema,
 * mantemos os imports usando o alias `@/modules/carteira/...` para
 * consistência com os outros módulos já migrados (campaigns/workflows/etc).
 *
 * Page deep-imports em App.tsx idem: @/pages/Produtos -> @/modules/carteira/pages/Produtos
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["src", "tests"];
const EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;

const CARTEIRA_HOOKS = new Set([
  "useAutoMoveUpsellClients",
  "useClientAlerts",
  "useDeals",
  "useDealItems",
  "useNewOrder",
  "useQuickOrder",
  "useOrderApproval",
  "usePortfolioClients",
  "usePortfolioKPIs",
  "usePortfolioTrends",
  "useProducts",
  "useProductMaterials",
  "useProductRanking",
  "useProductVariants",
  "useRetentionSuggestion",
  "useRevenueAtRisk",
  "useTinyErp",
  "useUpsellCampanhas",
  "useUpsellClientByLeadId",
  "useUpsellClientProducts",
  "useUpsellClients",
  "useUpsellGestaoRules",
  "useUpsellMetrics",
  "useUpsellOrders",
]);

const COMPONENT_MAP = {
  carteira: "client",
  upsell: "upsell",
  proposals: "proposal",
  deals: "deal",
  products: "product",
};

const PAGE_MAP = new Set(["Upsell", "Produtos"]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let s;
    try { s = statSync(p); } catch { continue; }
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

  // 1) @/components/<bucket>/X
  out = out.replace(
    /(['"])@\/components\/(carteira|upsell|proposals|deals|products)\/([^'"]+)\1/g,
    (m, q, bucket, rest) => {
      changes++;
      return `${q}@/modules/carteira/components/${COMPONENT_MAP[bucket]}/${rest}${q}`;
    },
  );

  // 2) @/hooks/<carteira-hook>(<rest>|"|')
  out = out.replace(
    /(['"])@\/hooks\/([A-Za-z0-9_]+)(\/[^'"]*)?\1/g,
    (m, q, hook, rest) => {
      if (!CARTEIRA_HOOKS.has(hook)) return m;
      changes++;
      return `${q}@/modules/carteira/hooks/${hook}${rest ?? ""}${q}`;
    },
  );

  // 3) Pages — @/pages/Upsell or @/pages/Produtos
  out = out.replace(
    /(['"])@\/pages\/(Upsell|Produtos)\1/g,
    (m, q, p) => {
      changes++;
      return `${q}@/modules/carteira/pages/${p}${q}`;
    },
  );
  // 3b) Same but relative (App.tsx uses "./pages/Produtos")
  out = out.replace(
    /(['"])\.\/pages\/(Upsell|Produtos)\1/g,
    (m, q, p) => {
      changes++;
      return `${q}@/modules/carteira/pages/${p}${q}`;
    },
  );

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
    process.stdout.write(`updated ${f.replace(ROOT + "\\", "").replace(/\\/g, "/")} (${changes})\n`);
  }
}

process.stdout.write(`\nTOTAL: ${touched} files, ${totalChanges} import rewrites\n`);
