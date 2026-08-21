/**
 * De qual tabela a caixa lê as mensagens. PURO.
 *
 * ─── POR QUE O DISCRIMINADOR NÃO É O `kind` ─────────────────────────────────
 *
 * O seletor decidia por `kind === "instagram"`: Instagram lê `channel_messages`,
 * o resto lê `whatsapp_messages`. A regra valia enquanto todo WhatsApp era Uazapi.
 *
 * O canal OFICIAL quebra a correspondência. Ele é `kind: "whatsapp"` porque mora
 * em `whatsapp_instances` — e isso é desenho, não acidente: dar a ele uma linha em
 * `messaging_channels` o rotularia como canal social em 13 telas e comeria uma
 * vaga PAGA de canal. Mas o inbound dele grava em `channel_messages`, junto com
 * Instagram e Facebook.
 *
 * Resultado medido em produção (2026-08-18): a mensagem entrou correta no banco e
 * ficou INVISÍVEL no chat, porque a caixa existia e lia a tabela errada.
 *
 * ⚠️ A REGRA É O PROVIDER, e a ausência dele significa o comportamento ANTIGO.
 * São ~30 organizações com instâncias gravadas antes de `provider` existir; um
 * default diferente as mandaria ler a tabela vazia e o inbox delas ficaria em
 * branco — o pior desfecho possível para uma mudança que deveria ser aditiva.
 */
import type { InboxBox } from "./types";

/** O provider do canal oficial. Uazapi e Evolution seguem em `whatsapp_messages`. */
const PROVIDER_CANAL_OFICIAL = "notificame";

export function boxUsesChannelMessages(box: InboxBox): boolean {
  if (box.kind === "instagram") return true;
  return box.provider === PROVIDER_CANAL_OFICIAL;
}
