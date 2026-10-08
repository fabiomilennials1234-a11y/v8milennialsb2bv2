import { useOrganization } from "@/modules/identity";
import { useFeatureFlag } from "@/modules/platform";
import { CAFE_JURERE_CLASSIFICACAO_FLAG, usaClassificacaoCafeJurere } from "../lib/cafe-jurere-classificacao";

export function useClassificacaoCafeJurere(): boolean {
  const { organizationId } = useOrganization();
  const { enabled, isLoading } = useFeatureFlag(CAFE_JURERE_CLASSIFICACAO_FLAG);
  return !isLoading && usaClassificacaoCafeJurere(organizationId, enabled);
}
