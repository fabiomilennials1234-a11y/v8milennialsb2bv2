/**
 * Nome do plano para gente ler.
 *
 * `organizations.subscription_plan` guarda a CHAVE do plano (`torque-v8`,
 * `torque-2.0`, `torque-1.0`): é estável de propósito, porque o gate de
 * features, as cotas e o add-on Turbo comparam esse texto. O nome comercial
 * mora em `subscription_plans.display_name` (Torque Copilot, Torque
 * Automation, Torque Base). Tela mostra o nome; nunca a chave.
 */

export interface PlanCatalogEntry {
  name: string;
  display_name: string | null;
}

export function planLabel(
  key: string | null | undefined,
  catalog: Map<string, PlanCatalogEntry> | undefined,
): string {
  if (!key) return "Sem plano";
  return catalog?.get(key)?.display_name?.trim() || key;
}
