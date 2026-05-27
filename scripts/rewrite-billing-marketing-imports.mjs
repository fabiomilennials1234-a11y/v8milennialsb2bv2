#!/usr/bin/env node
/**
 * Slice 13 billing + marketing — rewrites imports após mover componentes/hooks/pages
 * pra src/modules/billing/ e src/modules/marketing/.
 *
 * Regras (mantém o alias `@/modules/<bc>/...` em todas as referencias):
 *
 * Billing:
 * - @/components/subscription/<X>     -> @/modules/billing/components/subscription/<X>
 * - @/hooks/useCouponValidation       -> @/modules/billing/hooks/useCouponValidation
 * - @/lib/subscription                -> @/modules/billing/lib/subscription
 *
 * Marketing:
 * - @/components/landing/<X>          -> @/modules/marketing/components/landing/<X>
 * - @/components/marketing/<X>        -> @/modules/marketing/components/marketing/<X>
 * - @/hooks/useLandingAnimations      -> @/modules/marketing/hooks/useLandingAnimations
 * - @/hooks/useCadastroExterno        -> @/modules/marketing/hooks/useCadastroExterno
 * - @/pages/Landing                   -> @/modules/marketing/pages/Landing
 * - "./pages/Landing" (App.tsx)       -> "@/modules/marketing/pages/Landing"
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["src", "tests"];
const EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;

const BILLING_COMPONENT_BUCKETS = ["subscription"];
const MARKETING_COMPONENT_BUCKETS = ["landing", "marketing"];

const BILLING_HOOKS = new Set(["useCouponValidation"]);
const MARKETING_HOOKS = new Set(["useLandingAnimations", "useCadastroExterno"]);

const MARKETING_PAGES = new Set(["Landing"]);

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

  // 1) @/components/<billing-bucket>/...
  const billingBucketRegex = new RegExp(
    `(['"])@/components/(${BILLING_COMPONENT_BUCKETS.join("|")})/([^'"]+)\\1`,
    "g",
  );
  out = out.replace(billingBucketRegex, (m, q, bucket, rest) => {
    changes++;
    return `${q}@/modules/billing/components/${bucket}/${rest}${q}`;
  });

  // 2) @/components/<marketing-bucket>/...
  const marketingBucketRegex = new RegExp(
    `(['"])@/components/(${MARKETING_COMPONENT_BUCKETS.join("|")})/([^'"]+)\\1`,
    "g",
  );
  out = out.replace(marketingBucketRegex, (m, q, bucket, rest) => {
    changes++;
    return `${q}@/modules/marketing/components/${bucket}/${rest}${q}`;
  });

  // 3) @/hooks/<billing-hook>(/<rest>)?
  out = out.replace(
    /(['"])@\/hooks\/([A-Za-z0-9_]+)(\/[^'"]*)?\1/g,
    (m, q, hook, rest) => {
      if (BILLING_HOOKS.has(hook)) {
        changes++;
        return `${q}@/modules/billing/hooks/${hook}${rest ?? ""}${q}`;
      }
      if (MARKETING_HOOKS.has(hook)) {
        changes++;
        return `${q}@/modules/marketing/hooks/${hook}${rest ?? ""}${q}`;
      }
      return m;
    },
  );

  // 4) @/lib/subscription(/<rest>)?
  out = out.replace(
    /(['"])@\/lib\/subscription(\/[^'"]*)?\1/g,
    (m, q, rest) => {
      changes++;
      return `${q}@/modules/billing/lib/subscription${rest ?? ""}${q}`;
    },
  );

  // 5) @/pages/<marketing-page>
  out = out.replace(
    /(['"])@\/pages\/([A-Za-z0-9_]+)\1/g,
    (m, q, page) => {
      if (!MARKETING_PAGES.has(page)) return m;
      changes++;
      return `${q}@/modules/marketing/pages/${page}${q}`;
    },
  );

  // 6) "./pages/<marketing-page>" (App.tsx usa relativo)
  out = out.replace(
    /(['"])\.\/pages\/([A-Za-z0-9_]+)\1/g,
    (m, q, page) => {
      if (!MARKETING_PAGES.has(page)) return m;
      changes++;
      return `${q}@/modules/marketing/pages/${page}${q}`;
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
    process.stdout.write(
      `updated ${f.replace(ROOT + "\\", "").replace(/\\/g, "/")} (${changes})\n`,
    );
  }
}

process.stdout.write(`\nTOTAL: ${touched} files, ${totalChanges} import rewrites\n`);
