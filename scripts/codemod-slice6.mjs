#!/usr/bin/env node
/**
 * Slice 6 codemod — atualiza imports após mover o BC `communication`.
 *
 * Faz replace literal (case-sensitive) em arquivos .ts/.tsx sob src/ e tests/.
 * Não toca node_modules, dist, .specs, Obsidian.
 *
 * Padrão: replaces em ordem. Cada par [from, to] aplica replaceAll.
 *
 * NB: para hooks soltos (useWhatsAppChat etc.) e libs (whatsappApi etc.),
 * usamos paths exatos para evitar match parcial (ex: "useWhatsAppChat" não
 * deve afetar "useWhatsAppChatPause" hipotético).
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "tests"];
const EXTS = new Set([".ts", ".tsx"]);

// ────────────────────────────────────────────────────────────────────────
// Mapping table
// Order: mais específicos primeiro
// ────────────────────────────────────────────────────────────────────────

// Hooks soltos movidos para src/modules/communication/hooks/
const LOOSE_HOOKS = [
  "useChatBubble",
  "useChatBubbleState",
  "useConversationDraft",
  "useConversationHistory",
  "useConversationNotes",
  "useDeadSessions",
  "useHistorySyncJobs",
  "useIncomingMessageToast",
  "useMessageActions",
  "useMessageLimits",
  "useMessageTemplates",
  "useMetaConnection",
  "useOrgWhatsAppMigration",
  "usePreferredInstance",
  "useScheduledMessages",
  "useUserWriteInstanceFlag",
  "useWhatsAppChat",
  "useWhatsAppConversations",
  "useWhatsAppFunnel",
  "useWhatsAppInstanceAllowedMembers",
  "useWhatsAppInstances",
  "useWhatsAppLeadIntegration",
];

const REPLACEMENTS = [];

// Components folders
REPLACEMENTS.push(
  ['"@/components/chat/', '"@/modules/communication/components/chat/'],
  ['"@/components/chat"', '"@/modules/communication/components/chat"'],
  ['"@/components/chat-meta/', '"@/modules/communication/components/chat-meta/'],
  ['"@/components/chat-meta"', '"@/modules/communication/components/chat-meta"'],
  ['"@/components/whatsapp/', '"@/modules/communication/components/whatsapp/'],
  ['"@/components/whatsapp"', '"@/modules/communication/components/whatsapp"'],
  ['"@/components/whatsapp-migration/', '"@/modules/communication/components/whatsapp-migration/'],
  ['"@/components/whatsapp-migration"', '"@/modules/communication/components/whatsapp-migration"'],
);

// Hook folders
REPLACEMENTS.push(
  ['"@/hooks/chat/', '"@/modules/communication/hooks/chat/'],
  ['"@/hooks/chat"', '"@/modules/communication/hooks/chat"'],
  ['"@/hooks/chat-meta/', '"@/modules/communication/hooks/chat-meta/'],
  ['"@/hooks/chat-meta"', '"@/modules/communication/hooks/chat-meta"'],
);

// Loose hooks — only exact import paths (ending in name or name + " or name +.)
for (const h of LOOSE_HOOKS) {
  REPLACEMENTS.push(
    [`"@/hooks/${h}"`, `"@/modules/communication/hooks/${h}"`],
  );
}

// Lib files
REPLACEMENTS.push(
  ['"@/lib/whatsappApi"', '"@/modules/communication/lib/whatsappApi"'],
  ['"@/lib/whatsapp"', '"@/modules/communication/lib/whatsapp"'],
  ['"@/lib/chat-types"', '"@/modules/communication/lib/chat-types"'],
  ['"@/lib/primaryInstanceFor"', '"@/modules/communication/lib/primaryInstanceFor"'],
  ['"@/lib/computeNeedsDeepLinkResolve"', '"@/modules/communication/lib/computeNeedsDeepLinkResolve"'],
  ['"@/lib/audioToMp3"', '"@/modules/communication/lib/audioToMp3"'],
  ['"@/lib/prefetch/chatPrefetch"', '"@/modules/communication/lib/chatPrefetch"'],
);

// Pages
REPLACEMENTS.push(
  ['"@/pages/ChatWhatsApp"', '"@/modules/communication/pages/ChatWhatsApp"'],
  ['"@/pages/AtendimentoMeta"', '"@/modules/communication/pages/AtendimentoMeta"'],
);

// ────────────────────────────────────────────────────────────────────────
// Walk + replace
// ────────────────────────────────────────────────────────────────────────

const stats = {
  filesScanned: 0,
  filesChanged: 0,
  replacementsByPattern: new Map(),
};

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      walk(full);
      continue;
    }
    if (!st.isFile()) continue;
    if (!EXTS.has(extname(entry))) continue;
    processFile(full);
  }
}

function processFile(path) {
  stats.filesScanned++;
  let content;
  try { content = readFileSync(path, "utf8"); } catch { return; }
  let changed = false;
  for (const [from, to] of REPLACEMENTS) {
    if (content.includes(from)) {
      const before = content;
      // count occurrences
      let cnt = 0;
      let idx = 0;
      while ((idx = content.indexOf(from, idx)) !== -1) { cnt++; idx += from.length; }
      content = content.split(from).join(to);
      if (content !== before) {
        changed = true;
        stats.replacementsByPattern.set(
          from,
          (stats.replacementsByPattern.get(from) ?? 0) + cnt
        );
      }
    }
  }
  if (changed) {
    writeFileSync(path, content, "utf8");
    stats.filesChanged++;
  }
}

for (const d of SCAN_DIRS) {
  walk(join(ROOT, d));
}

console.log(`Scanned: ${stats.filesScanned}`);
console.log(`Changed: ${stats.filesChanged}`);
console.log("Replacements:");
for (const [pat, count] of [...stats.replacementsByPattern.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(4)}  ${pat}`);
}
