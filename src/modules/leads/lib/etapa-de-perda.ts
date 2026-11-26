export { etapaDoLeadEhDePerda } from "@/contracts/pipe/negocios-do-lead";

/**
 * Etapa inicial de uma opção de "Novo negócio": a primeira não-perda. O default
 * nunca nasce perdido (perda sem motivo). `""` quando não há opção ou todas
 * são de perda.
 */
export function etapaInicial(
  option: { stages: readonly { id: string; isLoss?: boolean }[] } | null | undefined,
): string {
  return option?.stages.find((s) => !s.isLoss)?.id ?? "";
}
