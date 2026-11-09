import { useFeatureFlag } from "@/modules/platform/hooks/useFeatureFlag";

/**
 * Nome da entidade "Lead" na interface (lateral e título de /leads).
 *
 * Hotfix Café Jurerê: lá o lead é o parceiro comercial, então a org com a flag
 * `ficha_do_parceiro` (`organizations.feature_flags`) vê "Ficha do Parceiro".
 * Fail-closed: sem flag, ou enquanto carrega, o nome é "Leads".
 */
export const LEADS_LABEL_DEFAULT = "Leads";
export const LEADS_LABEL_PARCEIRO = "Ficha do Parceiro";

export function leadsLabel(fichaDoParceiro: boolean): string {
  return fichaDoParceiro ? LEADS_LABEL_PARCEIRO : LEADS_LABEL_DEFAULT;
}

export function useLeadsLabel(): string {
  const { enabled } = useFeatureFlag("ficha_do_parceiro");
  return leadsLabel(enabled);
}
