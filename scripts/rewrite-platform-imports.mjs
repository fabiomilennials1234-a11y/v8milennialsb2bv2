#!/usr/bin/env node
/**
 * Slice 14 platform — rewrites imports após mover componentes/hooks/pages/lib
 * pra src/modules/platform/.
 *
 * Regras (mantém o alias `@/modules/platform/...` em todas as referencias):
 *
 * Components:
 * - @/components/onboarding/<X>          -> @/modules/platform/components/onboarding/<X>
 * - @/components/settings/<X>            -> @/modules/platform/components/settings/<X>
 * - @/components/system-alerts/<X>       -> @/modules/platform/components/system-alerts/<X>
 * - @/components/notifications/<X>       -> @/modules/platform/components/notifications/<X>
 * - @/components/GlobalErrorBoundary     -> @/modules/platform/components/GlobalErrorBoundary
 * - @/components/PushPermissionPrompt    -> @/modules/platform/components/PushPermissionPrompt
 * - @/components/ServiceWorkerUpdater    -> @/modules/platform/components/ServiceWorkerUpdater
 *
 * Hooks (top-level):
 * - @/hooks/use-push-subscription        -> @/modules/platform/hooks/use-push-subscription
 * - @/hooks/use-sw-update                -> @/modules/platform/hooks/use-sw-update
 * - @/hooks/useConsent                   -> @/modules/platform/hooks/useConsent
 * - @/hooks/useFeatureFlag               -> @/modules/platform/hooks/useFeatureFlag
 * - @/hooks/useHealthHistory             -> @/modules/platform/hooks/useHealthHistory
 * - @/hooks/useHelpCenter                -> @/modules/platform/hooks/useHelpCenter
 * - @/hooks/useLogger                    -> @/modules/platform/hooks/useLogger
 * - @/hooks/useOnlineStatus              -> @/modules/platform/hooks/useOnlineStatus
 * - @/hooks/useTrackView                 -> @/modules/platform/hooks/useTrackView
 * - @/hooks/useApiKeys                   -> @/modules/platform/hooks/useApiKeys
 * - @/hooks/useSlaConfigs                -> @/modules/platform/hooks/useSlaConfigs
 * - @/hooks/useWebhooks                  -> @/modules/platform/hooks/useWebhooks
 * - @/hooks/useOnboarding(Advance|State|Templates)? -> @/modules/platform/hooks/...
 *
 * Hooks (onboarding subdir):
 * - @/hooks/onboarding/<X>               -> @/modules/platform/hooks/onboarding/<X>
 *
 * Pages:
 * - @/pages/Configuracoes                -> @/modules/platform/pages/Configuracoes
 * - @/pages/Onboarding                   -> @/modules/platform/pages/Onboarding
 * - @/pages/Privacidade                  -> @/modules/platform/pages/Privacidade
 * - @/pages/NotFound                     -> @/modules/platform/pages/NotFound
 * - "./pages/Configuracoes" (App.tsx)    -> "@/modules/platform/pages/Configuracoes"
 *   idem Onboarding/Privacidade/NotFound
 *
 * Lib:
 * - @/lib/feature-flags                  -> @/modules/platform/lib/feature-flags
 * - @/lib/feature-registry               -> @/modules/platform/lib/feature-registry
 * - @/lib/logger                         -> @/modules/platform/lib/logger
 * - @/lib/optimistic-lock                -> @/modules/platform/lib/optimistic-lock
 * - @/lib/rate-limit                     -> @/modules/platform/lib/rate-limit
 * - @/lib/onboarding-suggestions         -> @/modules/platform/lib/onboarding-suggestions
 * - @/lib/pipeline-config-from-quiz      -> @/modules/platform/lib/pipeline-config-from-quiz
 * - @/lib/tv-config-from-quiz            -> @/modules/platform/lib/tv-config-from-quiz
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["src", "tests"];
const EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;

const COMPONENT_BUCKETS = ["onboarding", "settings", "system-alerts", "notifications"];
const ROOT_COMPONENTS = new Set([
  "GlobalErrorBoundary",
  "PushPermissionPrompt",
  "ServiceWorkerUpdater",
]);

const HOOKS = new Set([
  "use-push-subscription",
  "use-sw-update",
  "useConsent",
  "useFeatureFlag",
  "useHealthHistory",
  "useHelpCenter",
  "useLogger",
  "useOnlineStatus",
  "useTrackView",
  "useApiKeys",
  "useSlaConfigs",
  "useWebhooks",
  "useOnboarding",
  "useOnboardingAdvance",
  "useOnboardingState",
  "useOnboardingTemplates",
]);

const PAGES = new Set(["Configuracoes", "Onboarding", "Privacidade", "NotFound"]);

const LIBS = new Set([
  "feature-flags",
  "feature-registry",
  "logger",
  "optimistic-lock",
  "rate-limit",
  "onboarding-suggestions",
  "pipeline-config-from-quiz",
  "tv-config-from-quiz",
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

  // 1) @/components/<bucket>/...
  const bucketRegex = new RegExp(
    `(['"])@/components/(${COMPONENT_BUCKETS.join("|")})/([^'"]+)\\1`,
    "g",
  );
  out = out.replace(bucketRegex, (m, q, bucket, rest) => {
    changes++;
    return `${q}@/modules/platform/components/${bucket}/${rest}${q}`;
  });

  // 2) @/components/<RootComponent> (sem subpath)
  out = out.replace(
    /(['"])@\/components\/([A-Za-z0-9_-]+)\1/g,
    (m, q, name) => {
      if (!ROOT_COMPONENTS.has(name)) return m;
      changes++;
      return `${q}@/modules/platform/components/${name}${q}`;
    },
  );

  // 3) @/hooks/onboarding/<X>
  out = out.replace(
    /(['"])@\/hooks\/onboarding\/([^'"]+)\1/g,
    (m, q, rest) => {
      changes++;
      return `${q}@/modules/platform/hooks/onboarding/${rest}${q}`;
    },
  );

  // 4) @/hooks/<hook>(/rest)? — apenas hooks na lista
  out = out.replace(
    /(['"])@\/hooks\/([A-Za-z0-9_-]+)(\/[^'"]*)?\1/g,
    (m, q, hook, rest) => {
      if (!HOOKS.has(hook)) return m;
      changes++;
      return `${q}@/modules/platform/hooks/${hook}${rest ?? ""}${q}`;
    },
  );

  // 5) @/pages/<page>
  out = out.replace(
    /(['"])@\/pages\/([A-Za-z0-9_]+)\1/g,
    (m, q, page) => {
      if (!PAGES.has(page)) return m;
      changes++;
      return `${q}@/modules/platform/pages/${page}${q}`;
    },
  );

  // 6) "./pages/<page>" (App.tsx lazy imports)
  out = out.replace(
    /(['"])\.\/pages\/([A-Za-z0-9_]+)\1/g,
    (m, q, page) => {
      if (!PAGES.has(page)) return m;
      changes++;
      return `${q}@/modules/platform/pages/${page}${q}`;
    },
  );

  // 7) @/lib/<lib>(/rest)? — apenas libs na lista
  out = out.replace(
    /(['"])@\/lib\/([A-Za-z0-9_-]+)(\/[^'"]*)?\1/g,
    (m, q, lib, rest) => {
      if (!LIBS.has(lib)) return m;
      changes++;
      return `${q}@/modules/platform/lib/${lib}${rest ?? ""}${q}`;
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
