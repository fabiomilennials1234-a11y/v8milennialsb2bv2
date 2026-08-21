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

// ─── O que pode ser enviado ──────────────────────────────────────────────────

/** Tipos que o fornecedor aceita. `sticker` fica de fora: ele recusa. */
const MEDIA_TYPES = new Set(["image", "video", "audio", "document"]);

/**
 * Faixas que nunca devem ser buscadas por terceiro.
 *
 * ⚠️ SSRF COM EXECUTOR EMPRESTADO: quem baixa o arquivo é o FORNECEDOR, mas a
 * URL é escolhida pelo cliente. Um endereço interno aqui vira uma sonda contra a
 * rede de quem buscar — e o pedido sai com a reputação deles, não a nossa.
 */
const HOSTS_INTERNOS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[::1\]$/,
  /\.internal$/i,
  /\.local$/i,
];

export interface SocialMediaPayload {
  type: "image" | "video" | "audio" | "document";
  /** URL PÚBLICA — o provider recusa base64 com todas as letras. */
  file: string;
  caption?: string;
  filename?: string;
}

export type SocialSendPayload =
  | { ok: true; kind: "text"; text: string }
  | { ok: true; kind: "media"; media: SocialMediaPayload }
  | { ok: false; code: string; error: string };

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** A URL é pública e alcançável de fora? */
function urlPublicaValida(bruta: string): boolean {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return false;
  }
  // Só https: o fornecedor busca o arquivo, e um http exporia o conteúdo do
  // cliente em trânsito por um caminho que não controlamos.
  if (url.protocol !== "https:") return false;
  return !HOSTS_INTERNOS.some((padrao) => padrao.test(url.hostname));
}

/**
 * Lê o que o cliente quer enviar: texto ou mídia.
 *
 * MÍDIA TEM PRECEDÊNCIA sobre texto. Quando os dois vêm, o texto é a legenda do
 * anexo — mandar os dois separados entregaria a mesma frase duas vezes ao
 * cliente, uma solta e outra colada na imagem.
 */
export function readSocialSendPayload(body: Record<string, unknown>): SocialSendPayload {
  const bruta = body.media;

  if (bruta && typeof bruta === "object" && !Array.isArray(bruta)) {
    const m = bruta as Record<string, unknown>;
    const tipo = texto(m.type).toLowerCase();

    if (!MEDIA_TYPES.has(tipo)) {
      return {
        ok: false,
        code: "media_type_unsupported",
        error: "Este tipo de arquivo não pode ser enviado por aqui",
      };
    }

    const file = texto(m.url) || texto(m.file);
    if (!urlPublicaValida(file)) {
      return {
        ok: false,
        code: "media_url_invalid",
        error: "O arquivo precisa estar publicado numa URL https acessível",
      };
    }

    const caption = texto(m.caption) || texto(body.text);
    const filename = texto(m.filename) || texto(m.name);

    return {
      ok: true,
      kind: "media",
      media: {
        type: tipo as SocialMediaPayload["type"],
        file,
        ...(caption ? { caption } : {}),
        ...(filename ? { filename } : {}),
      },
    };
  }

  const t = texto(body.text);
  if (!t) {
    return { ok: false, code: "empty_message", error: "Escreva a mensagem ou anexe um arquivo" };
  }
  return { ok: true, kind: "text", text: t };
}
