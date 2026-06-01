#!/usr/bin/env node
/**
 * Slice 11 engagement — rewrites imports após mover componentes/hooks/pages
 * pra src/modules/engagement/.
 *
 * Regras (mantém o alias `@/modules/engagement/...` em todas as referencias,
 * inclusive dentro do proprio modulo, pra consistencia com slices anteriores):
 *
 * - @/components/<bucket>/X       -> @/modules/engagement/components/<bucket>/X
 *   buckets: agenda, activities, approvals, badges, checklists, comissoes,
 *            followups, gamification, ranking, revisao
 *
 * - @/hooks/<engagement-hook>     -> @/modules/engagement/hooks/<engagement-hook>
 *   (lista hardcoded abaixo)
 *
 * - @/pages/<engagement-page>     -> @/modules/engagement/pages/<engagement-page>
 *   pages: Agenda, ChecklistPage, Comissoes, Premiacoes, Ranking, Revisao,
 *          Metas, GestaoMetas
 *
 * - "./pages/<engagement-page>"   -> "@/modules/engagement/pages/<engagement-page>"
 *   (App.tsx usa relativo)
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["src", "tests"];
const EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;

const COMPONENT_BUCKETS = [
  "agenda",
  "activities",
  "approvals",
  "badges",
  "checklists",
  "comissoes",
  "followups",
  "gamification",
  "ranking",
  "revisao",
];

const ENGAGEMENT_HOOKS = new Set([
  "useActivities",
  "useAgendaEvents",
  "useApprovals",
  "useAwards",
  "useBadges",
  "useChecklists",
  "useChecklistTemplates",
  "useCoachingSuggestions",
  "useCommissions",
  "useFollowUps",
  "useRankingTransitions",
  "useRecentActivity",
  "useRecentItems",
  "useSellerActivity",
  "useVendedorRanking",
  "useAcoesDoDia",
  "useCallLogs",
  "useCloserPerformance",
  "useSDRPerformance",
  "useCompetitions",
  "useDailyPriorities",
  "useGoals",
  "useMeetings",
  "useMilestoneAutoUnlock",
  "useNextBestActions",
]);

const ENGAGEMENT_PAGES = new Set([
  "Agenda",
  "ChecklistPage",
  "Comissoes",
  "Premiacoes",
  "Ranking",
  "Revisao",
  "Metas",
  "GestaoMetas",
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

  // 1) @/components/<bucket>/X
  const bucketRegex = new RegExp(
    `(['"])@/components/(${COMPONENT_BUCKETS.join("|")})/([^'"]+)\\1`,
    "g",
  );
  out = out.replace(bucketRegex, (m, q, bucket, rest) => {
    changes++;
    return `${q}@/modules/engagement/components/${bucket}/${rest}${q}`;
  });

  // 2) @/hooks/<engagement-hook>(/<rest>)?
  out = out.replace(
    /(['"])@\/hooks\/([A-Za-z0-9_]+)(\/[^'"]*)?\1/g,
    (m, q, hook, rest) => {
      if (!ENGAGEMENT_HOOKS.has(hook)) return m;
      changes++;
      return `${q}@/modules/engagement/hooks/${hook}${rest ?? ""}${q}`;
    },
  );

  // 3) @/pages/<engagement-page>
  out = out.replace(
    /(['"])@\/pages\/([A-Za-z0-9_]+)\1/g,
    (m, q, page) => {
      if (!ENGAGEMENT_PAGES.has(page)) return m;
      changes++;
      return `${q}@/modules/engagement/pages/${page}${q}`;
    },
  );

  // 4) "./pages/<engagement-page>" (App.tsx usa relativo)
  out = out.replace(
    /(['"])\.\/pages\/([A-Za-z0-9_]+)\1/g,
    (m, q, page) => {
      if (!ENGAGEMENT_PAGES.has(page)) return m;
      changes++;
      return `${q}@/modules/engagement/pages/${page}${q}`;
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
