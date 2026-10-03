/**
 * spreadsheet-parse — client-side CSV parse + column auto-detection for the
 * "Subir planilha" blast source (ADR-0014, #906).
 *
 * The edge function (`disparo-planilha-create`) owns the upsert decision; the
 * client only turns an uploaded CSV into `{ phone, name?, company?, email? }`
 * rows. Parsing reuses papaparse (already a project dep — robust to quotes and
 * `;`/`,` delimiters); the column-detection and row-mapping below are pure so
 * they unit-test without a File or papaparse.
 *
 * Cross-runtime note: this is the Vite/front twin — it must NOT import the Deno
 * `_shared/*` partition. The preview counts come from the edge `dry_run`.
 */
import Papa from "papaparse";

export interface MappedRow {
  phone: string;
  name?: string;
  company?: string;
  email?: string;
}

export type ColumnField = "phone" | "name" | "company" | "email";

/** Header index per field, or -1 when no column matched. */
export interface ColumnMap {
  phone: number;
  name: number;
  company: number;
  email: number;
}

/** Header synonyms per field — matched accent- and case-insensitively, substring. */
const FIELD_SYNONYMS: Record<ColumnField, string[]> = {
  // phone first so a header like "telefone comercial" wins phone over company.
  phone: ["telefone", "celular", "whatsapp", "whats", "fone", "phone", "tel", "numero", "contato"],
  email: ["email", "e mail", "mail"],
  company: ["empresa", "company", "organizacao", "negocio", "razao", "cliente"],
  name: ["nome", "name", "responsavel", "contato nome"],
};

/** Lowercase, strip accents, collapse non-alphanumerics to single spaces. */
export function normalizeHeader(h: string): string {
  return (h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Auto-detect which header maps to each field. Each header is claimed by at most
 * one field; phone/email win ties over company/name (a "contato" column is a
 * phone, not a name). First matching header per field wins.
 */
export function detectColumnMap(headers: string[]): ColumnMap {
  const normalized = headers.map(normalizeHeader);
  const map: ColumnMap = { phone: -1, name: -1, company: -1, email: -1 };
  const claimed = new Set<number>();

  // Priority order resolves overlaps deterministically.
  const order: ColumnField[] = ["phone", "email", "company", "name"];
  for (const field of order) {
    const synonyms = FIELD_SYNONYMS[field];
    for (let i = 0; i < normalized.length; i++) {
      if (claimed.has(i)) continue;
      const h = normalized[i];
      if (!h) continue;
      if (synonyms.some((syn) => h === syn || h.includes(syn))) {
        map[field] = i;
        claimed.add(i);
        break;
      }
    }
  }
  return map;
}

/** Map a parsed grid (header row + data rows) to MappedRow[] via a column map. */
export function mapGridToRows(dataRows: string[][], map: ColumnMap): MappedRow[] {
  const pick = (row: string[], idx: number): string =>
    idx >= 0 && idx < row.length ? String(row[idx] ?? "").trim() : "";

  const out: MappedRow[] = [];
  for (const row of dataRows) {
    // Skip wholly empty rows (papaparse can yield trailing blanks).
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const phone = pick(row, map.phone);
    const name = pick(row, map.name);
    const company = pick(row, map.company);
    const email = pick(row, map.email);
    out.push({
      phone,
      name: name || undefined,
      company: company || undefined,
      email: email || undefined,
    });
  }
  return out;
}

export interface ParsedSpreadsheet {
  headers: string[];
  /** Raw data grid (no header row). */
  dataRows: string[][];
  map: ColumnMap;
  rows: MappedRow[];
}

/**
 * Parse raw CSV text (header row first) into headers + detected map + rows.
 * Pure over a string — used directly in tests; the File reader wraps this.
 */
export function parseSpreadsheetText(text: string): ParsedSpreadsheet {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
    // header:false → array-of-arrays so we control header detection ourselves.
  });
  const grid = (result.data ?? []).filter(Array.isArray) as string[][];
  if (grid.length === 0) {
    return { headers: [], dataRows: [], map: { phone: -1, name: -1, company: -1, email: -1 }, rows: [] };
  }
  const headers = grid[0].map((h) => String(h ?? "").trim());
  const dataRows = grid.slice(1);
  const map = detectColumnMap(headers);
  const rows = mapGridToRows(dataRows, map);
  return { headers, dataRows, map, rows };
}

/** Read + parse a File (CSV). Rejects on a papaparse error. */
export function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      encoding: "UTF-8",
      complete: (r) => {
        const grid = (r.data ?? []).filter(Array.isArray) as string[][];
        if (grid.length === 0) {
          resolve({ headers: [], dataRows: [], map: { phone: -1, name: -1, company: -1, email: -1 }, rows: [] });
          return;
        }
        const headers = grid[0].map((h) => String(h ?? "").trim());
        const dataRows = grid.slice(1);
        const map = detectColumnMap(headers);
        resolve({ headers, dataRows, map, rows: mapGridToRows(dataRows, map) });
      },
      error: (e: unknown) => reject(e),
    });
  });
}
