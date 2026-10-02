/**
 * Reads `src/integrations/supabase/types.ts` (read-only) and extracts the
 * `public` schema: table/view columns with their TS types, foreign keys
 * (Relationships) and RPC return shapes.
 *
 * Why: the mock never has to hand-describe the schema. Fixture rows are
 * padded with every real column (null / [] / 0 / false by type), embeds
 * (`select=*,lead:leads(*)`) resolve through the real FK graph, and an
 * unknown RPC answers with the right *shape* (array vs scalar) instead of a
 * guess that crashes `data.map`.
 */
import { readFileSync } from "node:fs";

const indentOf = (line) => line.length - line.trimStart().length;

export function loadSchema(typesPath) {
  const lines = readFileSync(typesPath, "utf8").split("\n");

  // Only the first `public:` block (the second one is the Constants export).
  const start = lines.findIndex((l) => /^ {2}public: \{$/.test(l));
  const tables = {}; // name -> { kind, columns: {col: {type, nullable}}, rels: [] }
  const functions = {}; // name -> { returnsArray, returnType }
  const enums = {}; // name -> [values]

  let section = null;
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}\}/.test(line)) break; // end of public
    const sec = line.match(/^ {4}(Tables|Views|Functions|Enums|CompositeTypes): \{/);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (section === "Tables" || section === "Views") {
      const t = line.match(/^ {6}([A-Za-z0-9_]+): \{$/);
      if (t) {
        const name = t[1];
        const entry = { kind: section === "Views" ? "view" : "table", columns: {}, rels: [] };
        tables[name] = entry;
        i = parseTableBody(lines, i + 1, entry);
      }
    } else if (section === "Functions") {
      const one = line.match(/^ {6}([A-Za-z0-9_]+): \{.*Returns: (.*) \}$/);
      if (one) {
        functions[one[1]] = classifyReturn({ text: one[2].trim(), isObject: false });
        continue;
      }
      const f = line.match(/^ {6}([A-Za-z0-9_]+):\s*(\|)?\s*(\{)?$/);
      if (f) {
        const name = f[1];
        // Scan forward to the first Returns: within this function block.
        let j = i + 1;
        let ret = null;
        for (; j < lines.length; j++) {
          if (/^ {6}[A-Za-z0-9_]+:/.test(lines[j]) || /^ {0,4}\S/.test(lines[j])) break;
          const r = lines[j].match(/^\s+Returns:\s*(.*)$/);
          if (r && ret === null) {
            const head = r[1].trim();
            if (head === "{" || head === "") {
              // multi-line object; find its closing line
              const base = indentOf(lines[j]);
              let k = j + 1;
              while (k < lines.length && !(indentOf(lines[k]) === base && /^\s*\}/.test(lines[k]))) k++;
              ret = { text: lines[k]?.trim() ?? "}", isObject: true };
              j = k;
            } else {
              ret = { text: head, isObject: false };
            }
          }
        }
        if (ret) functions[name] = classifyReturn(ret);
        i = j - 1;
      }
    } else if (section === "Enums") {
      const e = line.match(/^ {6}([A-Za-z0-9_]+):\s*(.*)$/);
      if (e) {
        let text = e[2];
        let j = i + 1;
        while (j < lines.length && indentOf(lines[j]) > 6) text += " " + lines[j].trim(), j++;
        enums[e[1]] = [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
        i = j - 1;
      }
    }
  }
  return { tables, functions, enums };
}

function classifyReturn(ret) {
  const returnsArray = /\[\]\s*$/.test(ret.text);
  let returnType = "json";
  if (ret.isObject) returnType = "object";
  else if (/^boolean/.test(ret.text)) returnType = "boolean";
  else if (/^number/.test(ret.text)) returnType = "number";
  else if (/^string/.test(ret.text)) returnType = "string";
  else if (/^undefined/.test(ret.text)) returnType = "void";
  else if (/Row"\]/.test(ret.text)) returnType = "object";
  return { returnsArray, returnType };
}

function parseTableBody(lines, i, entry) {
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {6}\}/.test(line)) return i;
    if (/^ {8}Row: \{/.test(line)) {
      i++;
      for (; i < lines.length && !/^ {8}\}/.test(lines[i]); i++) {
        const c = lines[i].match(/^ {10}([A-Za-z0-9_]+)\??:\s*(.*)$/);
        if (!c) continue;
        let type = c[2];
        let j = i + 1;
        while (j < lines.length && indentOf(lines[j]) > 10) type += " " + lines[j].trim(), j++;
        i = j - 1;
        entry.columns[c[1]] = { type: type.trim(), nullable: /\|\s*null\b/.test(type) };
      }
    }
    if (/^ {8}Relationships: \[$/.test(line)) {
      i++;
      let cur = null;
      for (; i < lines.length && !/^ {8}\]/.test(lines[i]); i++) {
        const l = lines[i].trim();
        if (l === "{") cur = {};
        else if (l.startsWith("}")) {
          if (cur) entry.rels.push(cur);
          cur = null;
        } else if (cur) {
          let m;
          if ((m = l.match(/^foreignKeyName: "([^"]+)"/))) cur.fk = m[1];
          else if ((m = l.match(/^columns: \[(.*)\]/))) cur.columns = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
          else if ((m = l.match(/^isOneToOne: (true|false)/))) cur.oneToOne = m[1] === "true";
          else if ((m = l.match(/^referencedRelation: "([^"]+)"/))) cur.ref = m[1];
          else if ((m = l.match(/^referencedColumns: \[(.*)\]/))) cur.refColumns = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
        }
      }
    }
  }
  return i;
}

/** Default value for a NOT NULL column, by TS type. Nullable → null. */
export function defaultFor(col, enums) {
  if (!col || col.nullable) return null;
  const t = col.type;
  if (/\[\]$/.test(t)) return [];
  if (/^string\b/.test(t)) return "";
  if (/^number\b/.test(t)) return 0;
  if (/^boolean\b/.test(t)) return false;
  if (/^Json\b/.test(t)) return {};
  const en = t.match(/\["Enums"\]\["([A-Za-z0-9_]+)"\]/);
  if (en && enums[en[1]]?.length) return enums[en[1]][0];
  const lit = t.match(/^"([^"]*)"/);
  if (lit) return lit[1];
  return null;
}
