/**
 * Qual estado a área de mensagens deve renderizar.
 *
 * Existe como função pura porque a regra é sobre a CONTRADIÇÃO entre duas
 * fontes (a lista e a thread), e essa é a parte que precisa de teste — montar
 * `ChatShellWithContext` inteiro só pra afirmar "isto não é conversa nova"
 * testaria a árvore de componentes, não a regra.
 *
 * `"inconsistent"` é o caso que motivou o arquivo: a thread volta 0 linhas SEM
 * erro, e mesmo assim a conversa não é nova. Negativa de RLS devolve zero
 * linhas em vez de erro, e `.in("instance_id", …)` não casa `instance_id NULL`
 * — os dois produzem silêncio, não exceção. Quem sabe que houve mensagem é a
 * LISTA, via `last_message_time` do contato.
 */
export type ThreadState = "loading" | "error" | "inconsistent" | "list";

export interface ResolveThreadStateInput {
  isLoading: boolean;
  isError: boolean;
  /** Mensagens que a thread conseguiu ler. */
  messageCount: number;
  /** Envios que falharam — vivem no cliente, não vêm da query. */
  failedCount: number;
  /** Ligações da conversa: entram na timeline e valem como conteúdo. */
  callCount: number;
  /**
   * `last_message_time` do contato na LISTA. Presente = a lista afirma que
   * existe mensagem. Ausente = deep-link/lead sem contato na lista, e aí
   * "conversa nova" é leitura legítima.
   */
  lastMessageTime: string | null | undefined;
}

export function resolveThreadState(input: ResolveThreadStateInput): ThreadState {
  if (input.isLoading) return "loading";
  if (input.isError) return "error";

  const vazia =
    input.messageCount === 0 &&
    input.failedCount === 0 &&
    input.callCount === 0;

  // Vazia E a lista diz que houve mensagem = contradição. Nunca "conversa nova".
  if (vazia && !!input.lastMessageTime) return "inconsistent";

  return "list";
}
