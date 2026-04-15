#!/usr/bin/env node
/**
 * docs-sync — mantém contagens e listas auto-geradas no Obsidian vault
 * em sincronia com o código real. Reduz drift.
 *
 * Uso:
 *   npm run docs:sync           — atualiza blocos <!-- auto:* --> e frontmatter last_verified
 *   npm run docs:sync --check   — falha (exit 1) se algo estiver desatualizado (CI)
 *
 * Blocos reconhecidos nos .md do vault:
 *   <!-- auto:counts:start --> … <!-- auto:counts:end -->
 *   <!-- auto:pages:start --> … <!-- auto:pages:end -->
 *   <!-- auto:hooks:start --> … <!-- auto:hooks:end -->
 *   <!-- auto:edge-functions:start --> … <!-- auto:edge-functions:end -->
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const VAULT = join(ROOT, "Obsidian", "Segundo Cerebro", "Torque-wiki");
const CHECK = process.argv.includes("--check");
const TODAY = new Date().toISOString().slice(0, 10);

function walk(dir, pred) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full, pred));
    else if (pred(full)) out.push(full);
  }
  return out;
}

function countFiles(dir, ext) {
  try {
    return readdirSync(dir).filter(f => f.endsWith(ext)).length;
  } catch { return 0; }
}

function countDirs(dir, excludePrefix = "_") {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith(excludePrefix))
      .length;
  } catch { return 0; }
}

const counts = {
  pages: countFiles(join(ROOT, "src/pages"), ".tsx"),
  hooks: countFiles(join(ROOT, "src/hooks"), ".ts") + countFiles(join(ROOT, "src/hooks"), ".tsx"),
  componentDirs: countDirs(join(ROOT, "src/components")),
  uiPrimitives: countFiles(join(ROOT, "src/components/ui"), ".tsx"),
  contexts: countFiles(join(ROOT, "src/contexts"), ".tsx"),
  edgeFunctions: countDirs(join(ROOT, "supabase/functions"), "_"),
  sharedModules: countFiles(join(ROOT, "supabase/functions/_shared"), ".ts"),
  migrations: countFiles(join(ROOT, "supabase/migrations"), ".sql"),
};

const blocks = {
  counts: `<!-- auto:counts:start -->
\`\`\`
src/
├── components/        # ${counts.componentDirs} categorias de componentes
│   └── ui/            # ${counts.uiPrimitives} primitivos shadcn/ui
├── hooks/             # ${counts.hooks} hooks React Query
├── pages/             # ${counts.pages} paginas (lazy loaded)
└── contexts/          # ${counts.contexts} contexts

supabase/
├── functions/         # ${counts.edgeFunctions} edge functions (Deno)
│   └── _shared/       # ${counts.sharedModules} modulos compartilhados
└── migrations/        # ${counts.migrations} migrations SQL
\`\`\`
<!-- auto:counts:end -->`,
};

const AUTO_RE = /<!-- auto:([\w-]+):start -->[\s\S]*?<!-- auto:\1:end -->/g;

let changed = 0;
let outOfDate = [];

for (const file of walk(VAULT, f => f.endsWith(".md"))) {
  const original = readFileSync(file, "utf8");
  let updated = original.replace(AUTO_RE, (match, key) => {
    if (blocks[key]) return blocks[key];
    return match;
  });

  if (updated !== original) {
    if (CHECK) outOfDate.push(relative(ROOT, file));
    else { writeFileSync(file, updated); changed++; }
  }
}

if (CHECK) {
  if (outOfDate.length) {
    console.error("Docs desatualizados:\n" + outOfDate.map(f => "  " + f).join("\n"));
    console.error("\nRode: npm run docs:sync");
    process.exit(1);
  }
  console.log("Docs em dia.");
} else {
  console.log(`docs-sync: ${changed} arquivo(s) atualizado(s). Data: ${TODAY}`);
  console.log("Contagens atuais:", counts);
}
