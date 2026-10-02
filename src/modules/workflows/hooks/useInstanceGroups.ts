import { useQuery } from "@tanstack/react-query";
import { whatsappApi } from "@/modules/communication";
import { useOrganization } from "@/modules/identity";

/**
 * Os grupos de que a instância participa — o seletor do nó "Enviar p/ grupo".
 *
 * A org entra na chave porque o proxy resolve o tenant pelo `selected_org_id`:
 * Master trocando de org não pode reaproveitar a lista da anterior. `retry: 1`
 * porque 403/422 são definitivos e o painel tem fallback manual — insistir só
 * atrasa o campo manual aparecer.
 */
export function useInstanceGroups(instanceId: string | null | undefined) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["instance-groups", organizationId, instanceId],
    queryFn: () => whatsappApi.listGroups(instanceId as string),
    enabled: !!instanceId && !!organizationId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
