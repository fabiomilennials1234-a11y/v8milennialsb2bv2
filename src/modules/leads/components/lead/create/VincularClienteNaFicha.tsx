import { useFeatureFlag } from "@/modules/platform";
import {
  FLAG_VINCULAR_CLIENTE_EXISTENTE,
  useVincularNumeroALead,
} from "@/modules/communication/hooks/useVincularNumeroALead";
import { VincularClienteExistente } from "./VincularClienteExistente";

/**
 * "Já é cliente?" na ficha da conversa sem lead (flag por org). Vinculado, o
 * número passa a ser do cliente e a ficha o encontra pelo telefone.
 *
 * Componente próprio para os hooks (flag, mutation) só existirem quando a
 * conversa está SEM lead — a ficha com lead fica exatamente como era.
 */
export function VincularClienteNaFicha({ phoneNumber, onVinculado }: { phoneNumber: string; onVinculado: () => void }) {
  const { enabled } = useFeatureFlag(FLAG_VINCULAR_CLIENTE_EXISTENTE);
  const vincular = useVincularNumeroALead();
  if (!enabled) return null;
  return (
    <VincularClienteExistente
      phoneNumber={phoneNumber}
      vinculandoId={vincular.isPending ? vincular.variables?.leadId ?? null : null}
      onVincular={(c) =>
        vincular.mutate({ phone: phoneNumber, leadId: c.id, leadName: c.name }, { onSuccess: onVinculado })
      }
    />
  );
}
