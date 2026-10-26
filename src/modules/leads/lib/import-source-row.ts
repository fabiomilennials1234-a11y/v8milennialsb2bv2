/**
 * Número da linha da PLANILHA de cada linha lida, para o relatório de importação.
 *
 * O relatório aponta "L8" e a pessoa abre a planilha para achar o 8. O número tem que
 * ser o do Excel/CSV (cabeçalho = linha 1, primeira linha de dados = 2). Contar a
 * posição no array mandado à edge erra por 1 (o cabeçalho) e mais ainda a cada linha
 * vazia ou sem nome descartada no caminho.
 *
 * Fica num WeakMap de propósito: a linha lida é `Record<string, string>` e suas chaves
 * viram as colunas mostradas no mapeamento; uma chave nova apareceria lá.
 */

const SOURCE_ROW = new WeakMap<object, number>();

export function markSourceRow<T extends object>(row: T, sheetRow: number): T {
  SOURCE_ROW.set(row, sheetRow);
  return row;
}

/** Linha da planilha de onde `row` saiu; `undefined` se a origem não a marcou. */
export function sourceRowOf(row: object): number | undefined {
  return SOURCE_ROW.get(row);
}

/** Linha de dados sem nenhum valor (só vírgulas / só espaços). */
export function isBlankRow(row: Record<string, string>): boolean {
  return Object.values(row).every((v) => !String(v ?? "").trim());
}
