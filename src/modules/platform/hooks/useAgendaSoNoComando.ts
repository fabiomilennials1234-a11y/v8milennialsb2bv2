import { useOrganization } from "@/modules/identity";
import { useFeatureFlag } from "./useFeatureFlag";

/**
 * Flag por org (`organizations.feature_flags`): a tela Agenda (`/agenda`) sai
 * do produto e o Comando (`/dashboard`) passa a ser o único lugar da agenda.
 * Pedido do CTO para a Café Jurerê (27/11): a Agenda do Comando já mostra
 * reuniões, mensagens e próximos contatos, e a tela à parte virou caminho
 * duplicado.
 */
export const FLAG_AGENDA_SO_NO_COMANDO = "agenda_so_no_comando";

export const ROTA_AGENDA = "/agenda";
export const ROTA_COMANDO = "/dashboard";

export interface AgendaSoNoComando {
  /** A org desligou a tela Agenda. */
  ativa: boolean;
  /** A flag ainda não respondeu. Só a rota espera por isto; o resto não some antes de saber. */
  isLoading: boolean;
}

export function useAgendaSoNoComando(): AgendaSoNoComando {
  const { organizationId, isLoading: orgLoading } = useOrganization();
  const { enabled, isLoading } = useFeatureFlag(FLAG_AGENDA_SO_NO_COMANDO);
  // Sem org não há flag a ler: `useFeatureFlag` ficaria "carregando" para
  // sempre e a rota da Agenda, presa no spinner.
  if (!orgLoading && !organizationId) return { ativa: false, isLoading: false };
  return { ativa: enabled, isLoading };
}
