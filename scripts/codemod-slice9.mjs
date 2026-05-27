#!/usr/bin/env node
/**
 * Codemod — Slice 9 (campaigns).
 *
 * Atualiza imports após mover:
 *   src/components/campanhas/*    → src/modules/campaigns/components/*
 *   src/hooks/useCampanhas        → src/modules/campaigns/hooks/useCampanhas
 *   src/hooks/useCampaignTemplates → src/modules/campaigns/hooks/useCampaignTemplates
 *   src/hooks/useMassSendJobs     → src/modules/campaigns/hooks/useMassSendJobs
 *   src/hooks/useDispatchQueueItems → src/modules/campaigns/hooks/useDispatchQueueItems
 *   src/pages/Campanhas           → src/modules/campaigns/pages/Campanhas
 *   src/pages/CampanhaDetail      → src/modules/campaigns/pages/CampanhaDetail
 *   src/pages/campaigns/MassSend  → src/modules/campaigns/pages/MassSend
 *
 * Uso: node scripts/codemod-slice9.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const REPLACEMENTS = [
  // Components — alias absoluto
  { from: /@\/components\/campanhas\//g, to: "@/modules/campaigns/components/" },

  // Hooks individuais — alias absoluto
  { from: /@\/hooks\/useCampanhas(?=["'])/g, to: "@/modules/campaigns/hooks/useCampanhas" },
  { from: /@\/hooks\/useCampaignTemplates(?=["'])/g, to: "@/modules/campaigns/hooks/useCampaignTemplates" },
  { from: /@\/hooks\/useMassSendJobs(?=["'])/g, to: "@/modules/campaigns/hooks/useMassSendJobs" },
  { from: /@\/hooks\/useDispatchQueueItems(?=["'])/g, to: "@/modules/campaigns/hooks/useDispatchQueueItems" },

  // Pages — alias absoluto
  { from: /@\/pages\/Campanhas(?=["'])/g, to: "@/modules/campaigns/pages/Campanhas" },
  { from: /@\/pages\/CampanhaDetail(?=["'])/g, to: "@/modules/campaigns/pages/CampanhaDetail" },
  { from: /@\/pages\/campaigns\/MassSend(?=["'])/g, to: "@/modules/campaigns/pages/MassSend" },

  // App.tsx — paths relativos a partir de ./pages
  { from: /\.\/pages\/Campanhas(?=["'])/g, to: "@/modules/campaigns/pages/Campanhas" },
  { from: /\.\/pages\/CampanhaDetail(?=["'])/g, to: "@/modules/campaigns/pages/CampanhaDetail" },
  { from: /\.\/pages\/campaigns\/MassSend(?=["'])/g, to: "@/modules/campaigns/pages/MassSend" },
];

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build") continue;
      yield* walk(full);
    } else if (entry.isFile() && /\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      yield full;
    }
  }
}

const targets = [path.join(ROOT, "src"), path.join(ROOT, "tests")];

let totalFiles = 0;
let totalReplaces = 0;

for (const root of targets) {
  for await (const file of walk(root)) {
    const original = await fs.readFile(file, "utf8");
    let updated = original;
    let fileReplaces = 0;
    for (const { from, to } of REPLACEMENTS) {
      const matches = updated.match(from);
      if (matches) {
        fileReplaces += matches.length;
        updated = updated.replace(from, to);
      }
    }
    if (fileReplaces > 0) {
      await fs.writeFile(file, updated, "utf8");
      totalFiles += 1;
      totalReplaces += fileReplaces;
      console.log(`  ${path.relative(ROOT, file)}  (+${fileReplaces})`);
    }
  }
}

console.log(`\n→ ${totalReplaces} substituições em ${totalFiles} arquivos.`);
