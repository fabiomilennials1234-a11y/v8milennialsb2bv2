/**
 * Encaminhar mensagem — reenviar uma mensagem existente do chat para OUTRA
 * conversa da mesma org, marcada como encaminhada.
 *
 * Decisões (CTO, 2026-10-08), e onde cada uma mora:
 *
 *  1. Passa pelo Send Governor como envio MANUAL e conta no ledger do chip. O
 *     composer do proxy não é governado (`whatsapp-api-proxy` 3.5); encaminhar
 *     é, porque N encaminhamentos são envio em massa com outro nome. Um destino
 *     por ação — o payload só carrega um `number`.
 *  2. Destino: conversa 1:1 que já existe no Torque. O chip é o da conversa de
 *     DESTINO (a instância do request), nunca o da origem: mandar pelo chip da
 *     origem abriria contato frio num número que nunca falou com o lead.
 *  3. Mídia: URL do nosso Storage vai direto. Qualquer outra (CDN criptografada
 *     do WhatsApp, mídia de grupo, link vazio) é baixada sob demanda pelo chip
 *     da ORIGEM — é ele que tem a chave da mídia.
 *  4. Permissão: o guard de responsável roda para o destino no choke do proxy
 *     e, aqui, para a origem. Sem o segundo, quem não vê uma conversa copiaria
 *     o conteúdo dela para uma conversa que vê.
 *  5. Evidência: `forward: true` no provider (rótulo nativo "Encaminhada" no
 *     WhatsApp) + `forwarded_from_message_id` na linha gravada (quem e de onde).
 *
 * O módulo é puro em I/O: tudo que toca banco ou provider entra por `deps`.
 */

/** Tipos de mídia que o provider sabe reenviar. `ptt` segue como nota de voz. */
export type ForwardMediaType = "image" | "video" | "document" | "audio" | "ptt" | "sticker";

const MEDIA_TYPES: ReadonlySet<string> = new Set<ForwardMediaType>([
  "image",
  "video",
  "document",
  "audio",
  "ptt",
  "sticker",
]);

/** `conversation` é texto puro no vocabulário do WhatsApp — o webhook grava os dois. */
const TEXT_TYPES: ReadonlySet<string> = new Set(["text", "conversation"]);

export interface ForwardSource {
  id: string;
  instance_id: string | null;
  message_id: string;
  message_type: string | null;
  content: string | null;
  media_url: string | null;
  media_file_name: string | null;
}

export type ForwardPlan =
  | { kind: "text"; text: string }
  | {
      kind: "media";
      type: ForwardMediaType;
      /** URL do nosso Storage, ou null quando a mídia precisa ser baixada da origem. */
      url: string | null;
      filename?: string;
      caption?: string;
    }
  | { kind: "unsupported"; reason: string };

/**
 * Só o NOSSO Storage público vai como URL. Link da CDN do WhatsApp é
 * criptografado (o destinatário receberia lixo) e qualquer outro host é URL que
 * não emitimos — reenviar seria repassar ao provider um endereço de terceiro.
 */
export function isOwnStorageUrl(url: string | null | undefined, supabaseUrl: string): boolean {
  if (!url || !supabaseUrl) return false;
  const base = supabaseUrl.replace(/\/+$/, "");
  return url.startsWith(`${base}/storage/v1/object/public/`);
}

export function planForward(source: ForwardSource, supabaseUrl: string): ForwardPlan {
  const type = (source.message_type ?? "").trim();
  const content = source.content?.trim() ? source.content : null;

  if (TEXT_TYPES.has(type)) {
    if (!content) return { kind: "unsupported", reason: "Mensagem sem texto para encaminhar." };
    return { kind: "text", text: content };
  }

  if (MEDIA_TYPES.has(type)) {
    const mediaType = type as ForwardMediaType;
    return {
      kind: "media",
      type: mediaType,
      url: isOwnStorageUrl(source.media_url, supabaseUrl) ? source.media_url : null,
      ...(mediaType === "document" && source.media_file_name
        ? { filename: source.media_file_name }
        : {}),
      // Legenda só onde o WhatsApp a exibe. Em áudio e figurinha o `content` é
      // texto de apoio do nosso lado (transcrição, rótulo), não legenda.
      ...((mediaType === "image" || mediaType === "video" || mediaType === "document") && content
        ? { caption: content }
        : {}),
    };
  }

  return {
    kind: "unsupported",
    reason: "Este tipo de mensagem não pode ser encaminhado.",
  };
}

export interface ForwardSendResult {
  success: boolean;
  messageId?: string;
  status?: string;
  error?: string;
}

export interface ForwardDeps {
  /** Linha de origem, já escopada à org do chamador e sem `deleted_at`. */
  loadSource(): Promise<ForwardSource | null>;
  /** Guard de responsável aplicado à conversa de ORIGEM. */
  canSeeSource(source: ForwardSource): Promise<boolean>;
  /** Baixa a mídia pelo chip da ORIGEM. */
  downloadFromSource(source: ForwardSource): Promise<{ base64: string; mimetype: string }>;
  sendText(text: string): Promise<ForwardSendResult>;
  sendMedia(media: {
    type: ForwardMediaType;
    file: string;
    filename?: string;
    caption?: string;
  }): Promise<ForwardSendResult>;
  /**
   * Grava a evidência. Chamado só depois de o provider aceitar; falhar aqui não
   * pode virar erro para o usuário — reenviar duplicaria o que já saiu.
   */
  persist(sent: {
    messageId: string;
    status: string | undefined;
    plan: Exclude<ForwardPlan, { kind: "unsupported" }>;
    source: ForwardSource;
  }): Promise<void>;
}

export type ForwardOutcome =
  | { status: 200; body: { ok: true; result: { message_id: string | null; status?: string } } }
  | { status: 403 | 404 | 422 | 502; body: { error: string; reason?: string } };

export async function executeForward(
  deps: ForwardDeps,
  supabaseUrl: string,
): Promise<ForwardOutcome> {
  const source = await deps.loadSource();
  if (!source) {
    return { status: 404, body: { error: "Mensagem de origem não encontrada." } };
  }

  if (!(await deps.canSeeSource(source))) {
    return { status: 403, body: { error: "Forbidden", reason: "chat_owner" } };
  }

  const plan = planForward(source, supabaseUrl);
  if (plan.kind === "unsupported") {
    return { status: 422, body: { error: plan.reason } };
  }

  let sent: ForwardSendResult;
  if (plan.kind === "text") {
    sent = await deps.sendText(plan.text);
  } else {
    let file = plan.url;
    if (!file) {
      try {
        const media = await deps.downloadFromSource(source);
        if (!media?.base64) throw new Error("empty media");
        file = media.base64;
      } catch {
        return {
          status: 502,
          body: { error: "Mídia indisponível no WhatsApp: não foi possível baixar o arquivo original." },
        };
      }
    }
    sent = await deps.sendMedia({
      type: plan.type,
      file,
      ...(plan.filename ? { filename: plan.filename } : {}),
      ...(plan.caption ? { caption: plan.caption } : {}),
    });
  }

  if (!sent.success) {
    return { status: 502, body: { error: sent.error ?? "O WhatsApp recusou o envio." } };
  }

  // Aceito sem id do provider: a mensagem saiu, só não há como amarrar a
  // evidência à linha que o eco vai gravar. Responder erro aqui faria o usuário
  // tentar de novo e duplicar o envio.
  if (sent.messageId) {
    try {
      await deps.persist({ messageId: sent.messageId, status: sent.status, plan, source });
    } catch {
      console.warn("[whatsapp-forward] persistência da evidência falhou após envio aceito");
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      result: {
        message_id: sent.messageId ?? null,
        ...(sent.status ? { status: sent.status } : {}),
      },
    },
  };
}
