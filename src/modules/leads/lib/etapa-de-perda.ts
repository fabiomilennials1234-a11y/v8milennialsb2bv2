import { isEtapaDePerda } from "@/contracts/pipe/perda";

/**
 * A etapa (no shape de `useLeadAllPipelines`: `role` / `isFinalNegative`) é de
 * perda? Adaptador fino para o predicado único `isEtapaDePerda` — toda tela que
 * move a partir dessas linhas pergunta o motivo pela mesma régua.
 */
export function etapaDoLeadEhDePerda(
  stage: { role?: string | null; isFinalNegative?: boolean } | null | undefined,
): boolean {
  return isEtapaDePerda(stage ? { stage_role: stage.role, is_final_negative: stage.isFinalNegative } : null);
}

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
