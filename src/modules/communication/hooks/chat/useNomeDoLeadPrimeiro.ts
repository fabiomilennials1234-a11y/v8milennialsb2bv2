import { useFeatureFlag } from "@/modules/platform/hooks/useFeatureFlag";

/**
 * Flag por org `chat_nome_do_lead`: o nome da conversa é o `leads.name` na
 * lista, no cabeçalho e no painel lateral (ver `nomeComLeadPrimeiro`).
 *
 * Fail-closed enquanto a flag carrega: a primeira frame usa a regra de sempre e
 * troca quando a flag chega. É o ÚNICO lugar do código que conhece a chave.
 */
export function useNomeDoLeadPrimeiro(): boolean {
  return useFeatureFlag("chat_nome_do_lead").enabled === true;
}
