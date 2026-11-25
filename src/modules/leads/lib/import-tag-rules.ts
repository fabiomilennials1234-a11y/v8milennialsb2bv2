/**
 * Etiqueta pela coluna da planilha: cada valor de uma coluna ("Segmento") ligado a
 * uma etiqueta. O mapa é lembrado por org em `import_tag_rules`, com coluna e valor
 * dobrados — "Empório", "emporio" e " EMPÓRIO " são o mesmo valor.
 */

/** Minúsculo, sem acento, espaços internos colapsados. A chave de coluna e de valor. */
export function foldValue(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Colunas que costumam dizer o segmento; a primeira presente vira a sugestão. */
const SEGMENT_COLUMNS = ["segmento", "segment", "setor", "ramo", "categoria", "tipo"];

export function defaultTagColumn(columns: string[]): string | null {
  for (const wanted of SEGMENT_COLUMNS) {
    const hit = columns.find((c) => foldValue(c) === wanted);
    if (hit) return hit;
  }
  return null;
}

export interface ColumnValue {
  /** Como aparece na planilha (a primeira grafia vista). */
  label: string;
  /** Chave dobrada. */
  key: string;
  count: number;
}

/** Valores distintos da coluna, do mais frequente ao menos; vazio fica de fora. */
export function distinctValues(rows: Record<string, string>[], column: string): ColumnValue[] {
  const byKey = new Map<string, ColumnValue>();
  for (const row of rows) {
    const raw = (row[column] ?? "").trim();
    const key = foldValue(raw);
    if (!key) continue;
    const hit = byKey.get(key);
    if (hit) hit.count++;
    else byKey.set(key, { label: raw, key, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

/** Valor dobrado → etiqueta (ausente = sem etiqueta). */
export type ValueTagMap = Record<string, string>;

export interface SavedTagRule {
  source_column: string;
  source_value: string;
  tag_id: string;
}

/** O mapa salvo para esta coluna, restrito às etiquetas que ainda existem. */
export function savedMapFor(rules: SavedTagRule[], column: string, existingTagIds: Set<string>): ValueTagMap {
  const col = foldValue(column);
  const out: ValueTagMap = {};
  for (const r of rules) {
    if (r.source_column === col && existingTagIds.has(r.tag_id)) out[r.source_value] = r.tag_id;
  }
  return out;
}

/** Regra que a linha leva para a edge: a coluna lida e a etiqueta de cada valor. */
export interface RowTagRule {
  column: string;
  byValue: ValueTagMap;
}

/** Etiquetas da linha pela regra; `undefined` quando o valor não tem etiqueta. */
export function rowTagIds(rule: RowTagRule | undefined, row: Record<string, string>): string[] | undefined {
  if (!rule) return undefined;
  const tag = rule.byValue[foldValue(row[rule.column])];
  return tag ? [tag] : undefined;
}
