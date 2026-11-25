/**
 * Erros do relatório da edge `import-leads`.
 *
 * `kind` diz por que a linha não entrou. A tela contava "duplicados" por regex no texto
 * do motivo, e cada frase nova ("Já é cliente do ERP — cód …") caía em "inválidos".
 */

/** Espelho de `ImportErrorKind` da edge `import-leads`. */
export type ImportErrorKind = "duplicado" | "ja_cadastrado" | "invalido" | "falha";

export interface ImportReportError {
  row: number;
  reason: string;
  kind?: ImportErrorKind;
}

/** Edge publicada antes do `kind`: a classificação ainda vem do texto. */
const DUPLICATE_REASON = /duplicado|ja existe|já existe|sem dados novos|já é cliente/i;

/** Linhas recusadas porque o contato já estava na planilha ou no CRM. */
export function countDuplicates(errors: ImportReportError[]): number {
  return errors.filter((e) =>
    e.kind ? e.kind === "duplicado" || e.kind === "ja_cadastrado" : DUPLICATE_REASON.test(e.reason),
  ).length;
}
