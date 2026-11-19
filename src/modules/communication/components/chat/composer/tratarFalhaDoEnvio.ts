import { toast } from "sonner";
import { notifyError } from "@/shared/errors";
import {
  FilaCheiaError,
  FilaInterrompidaError,
  MENSAGEM_DE_FILA_CHEIA,
} from "@/modules/communication/hooks/chat/shared/filaDeEnvio";

/**
 * Desfecho de um item da fila de envio (useWhatsAppSend + shared/filaDeEnvio),
 * o MESMO nos três composers (chat, bolha, celular).
 *
 * Não há trava no composer: texto e mídia entram na fila da conversa, que
 * garante a ordem e um envio em voo por vez. Ao composer sobram três casos:
 *  - fila cheia → o item nem entrou (sem bolha); avisa e devolve o rascunho
 *    (`restaurar`) — senão o texto se perderia calado;
 *  - interrompido → a bolha de falha já diz "a anterior falhou"; um toast por
 *    item que esperava seria ruído em cima do aviso da falha real;
 *  - falha real → o toast de sempre (a bolha de reenvio também fica).
 */
export function tratarFalhaDoEnvio(err: unknown, fallback: string, restaurar?: () => void): void {
  if (err instanceof FilaCheiaError) {
    restaurar?.();
    toast.warning(MENSAGEM_DE_FILA_CHEIA);
    return;
  }
  if (err instanceof FilaInterrompidaError) return;
  notifyError(err, { fallback });
}
