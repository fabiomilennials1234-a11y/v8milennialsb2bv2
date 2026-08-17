/**
 * Gate de envio pelo canal social (Instagram / Facebook).
 *
 * O `messaging_channel_id` e o destinatário chegam DO CLIENTE. É o mesmo vetor
 * que o gate de templates fecha — função com credencial de servidor que recorta
 * por parâmetro do cliente sem conferir o parâmetro —, e aqui o dano é maior:
 * não é leitura, é ESCRITA. Um canal alheio aceito aqui manda mensagem, com a
 * marca do cliente, pela conta de outro tenant.
 *
 * O CONTRATO DO ENVIO está confirmado por DUAS fontes independentes do
 * fornecedor (doc `app.notificame.com.br/docs/api.md` e o node oficial
 * `n8n-nodes-notificame-hub`):
 *
 *   POST /v2/channels/instagram/messages
 *   X-Api-Token: <token da conta>
 *   { "from": <id do canal>, "to": <IGSID>, "contents": [{ "type": "text", "text": "..." }] }
 *
 * ⚠️ A doc do fornecedor declara janela: "precisa estar dentro do período de
 *    mensagens (até 24 horas após a última resposta do destinatário)". Este
 *    módulo NÃO bloqueia por janela — decisão de produto, para o operador não
 *    ficar refém de um cálculo nosso —, mas a tela mostra o tempo restante e a
 *    recusa do fornecedor sobe legível.
 */

/** Linha de `messaging_channels`. */
export interface SocialChannelRow {
  organization_id: string;
  provider: string | null;
  channel_type: string | null;
  status: string | null;
  external_channel_id: string | null;
}

export type SocialSendChannel =
  | { ok: true; channelId: string; channelKind: "instagram" | "facebook" }
  | { ok: false; code: string; status: number; error: string };

/** Canal ausente e canal alheio respondem IGUAL — o erro não pode virar oráculo. */
const notFound: SocialSendChannel = {
  ok: false,
  code: "channel_not_found",
  status: 404,
  error: "Canal não encontrado nesta organização",
};

const SOCIAIS = new Set(["instagram", "facebook"]);

export function resolveSocialSendChannel(
  row: SocialChannelRow | null,
  orgId: string,
): SocialSendChannel {
  if (!row || row.organization_id !== orgId) return notFound;

  if (row.provider !== "notificame") {
    return {
      ok: false,
      code: "channel_not_notificame",
      status: 422,
      error: "Este canal não é do NotificaMe",
    };
  }

  const kind = (row.channel_type ?? "").trim().toLowerCase();

  // WhatsApp NÃO entra por aqui, e a recusa é de MODELO. Número de WhatsApp mora
  // em `whatsapp_instances` e carrega superfície própria — governor de envio,
  // janela, templates, teto por instância. Um canal de WhatsApp aceito nesta
  // porta driblaria tudo isso em silêncio.
  if (!SOCIAIS.has(kind)) {
    return {
      ok: false,
      code: "channel_not_social",
      status: 422,
      error: "Esta rota envia apenas por canais sociais",
    };
  }

  if (row.status !== "connected") {
    return {
      ok: false,
      code: "channel_not_connected",
      status: 409,
      error: "O canal não está conectado",
    };
  }

  const channelId = (row.external_channel_id ?? "").trim();
  if (!channelId) {
    return {
      ok: false,
      code: "channel_missing_external_id",
      status: 422,
      error: "O canal não tem identificador do fornecedor",
    };
  }

  return { ok: true, channelId, channelKind: kind as "instagram" | "facebook" };
}
