// deno-lint-ignore-file no-explicit-any
/**
 * NotificameProvider — ENVIO pelo canal OFICIAL do NotificaMe (WhatsApp e Instagram).
 *
 * É a fatia que faz a integração existir: até aqui o canal nascia (fatia 1),
 * aparecia na tela (1.1) e recebia (inbound). Nada saía.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⛔ NENHUM CANAL ESTAVA CONECTADO QUANDO ISTO FOI ESCRITO.                ║
 * ║                                                                          ║
 * ║  O ENVELOPE de saída ({from,to,contents}) e as ROTAS são FATOS            ║
 * ║  verificados. O SHAPE DA RESPOSTA é DERIVADO DE DOC — nunca foi visto     ║
 * ║  numa conta viva. É por isso que `readSentMessageId` é tolerante em       ║
 * ║  ALIAS e INTOLERANTE em ausência: sem id, o envio FALHA ALTO. Ver o       ║
 * ║  bloco "O id é o veredito" abaixo.                                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── O que este provider fala, e com que credencial ──────────────────────────
 *
 *   POST /v2/channels/whatsapp/messages     (canal de WhatsApp oficial)
 *   POST /v2/channels/instagram/messages    (canal de Instagram)
 *   GET  /v1/channels                       (status — via `listChannels`)
 *
 * SEMPRE com `X-Api-Token` = o token da SUBCONTA daquela org, lido do cofre
 * cifrado (`loadNotificameSubaccount`). O token da CONTA-MÃE não é importado
 * neste arquivo, não é lido de env aqui, e não tem como chegar: `orgConfigFrom`
 * só aceita o token já decifrado da subconta. Com o token do pai, um envio
 * falaria em nome da revenda inteira — o vazamento que o rework fechou.
 *
 * ─── O id é o veredito (o defeito que NÃO se copia) ──────────────────────────
 *
 * `send-meta-message/index.ts` L137 grava
 *     external_id: result.message_id || `meta_${Date.now()}`
 * Um id inventado por relógio: a UNIQUE `(external_id, channel, organization_id)`
 * nunca colide, então toda reentrega vira linha nova, e nenhum status de entrega
 * do fornecedor jamais casa com a linha. A conversa fica cheia de mensagens que
 * ninguém consegue confirmar que saíram.
 *
 * Aqui: sem id legível, `NotificameError('send_no_message_id')`. Nada é gravado.
 * O usuário vê falha. Preferir o erro é a decisão — um "enviado" falso some por
 * semanas, e a doc do fornecedor já mentiu sobre `POST /v2/accounts`.
 *
 * ─── Veredito pelo CORPO, nunca por `res.ok`/`res.status` ────────────────────
 *
 * Provado contra a conta viva: rota desconhecida devolve HTTP **200** com
 * `{"error":{"code":"Hub404"}}`; falha de autenticação devolve HTTP **404** com
 * `{"code":"AUTHENTICATION_ERROR"}`. Ler o status erra nas duas direções. Todo
 * corpo passa por `parseNotificameBody`.
 *
 * ─── O que este provider NÃO faz (e por quê é NotSupportedError, não silêncio) ─
 *
 * O canal oficial não tem QR, não tem histórico, não tem `/sender/*`, não tem
 * botão de Pix nem menu, não reage/edita/fixa/apaga. Cada um desses lança
 * `NotSupportedError`, cuja mensagem contém "does not support" — a string que o
 * matcher `isFeatureUnavailable()` do front usa para mostrar "recurso
 * indisponível neste número" em vez de um 500 cru. Mesmo contrato que
 * `EvolutionProvider` e `MetaCloudProvider` (cert Rule 7).
 *
 * `sendTemplate` e `checkNumbers` ficam AUSENTES (não lançam): são opcionais na
 * interface e os chamadores fazem feature-detect. Template pelo NotificaMe é
 * frente própria (os templates são POR CANAL, `GET /v2/templates?channel_id=…`);
 * declarar um método que lançasse aqui trocaria "ainda não" por "nunca".
 *
 * ─── Dispatch automático continua FECHADO ────────────────────────────────────
 *
 * `_shared/whatsapp-dispatch.ts` e o wizard de Disparo escopam por allowlist
 * `('uazapi','evolution')`. Este arquivo NÃO afrouxa nada disso, de propósito:
 * canal oficial só pode mandar forma livre dentro da janela de 24h, e a janela
 * não existe ainda. Enquanto não existir, envio oficial é ação HUMANA.
 */

import {
  NotSupportedError,
  type CreateInstanceInput,
  type CreateInstanceResult,
  type InstanceStatus,
  type SendMediaOptions,
  type SendResult,
  type SendTemplateOptions,
  type SendTextOptions,
  type WhatsAppProvider,
} from "../whatsapp-client.ts";
import {
  listChannels,
  NOTIFICAME_DEFAULT_BASE_URL,
  NotificameError,
  orgConfigFrom,
  parseNotificameBody,
  vendorDetailFromParse,
  readNotificameBaseUrl,
  type FetchImpl,
  type NotificameOrgConfig,
} from "../notificame.ts";
import { loadNotificameSubaccount } from "../notificame-credentials.ts";
import {
  buildTemplateSendContent,
  type TemplateSendComponent,
  type TemplateSendParameter,
} from "../notificame-templates.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Nome do provider. Casa com `whatsapp_instances.provider` e `messaging_channels.provider`. */
export const NOTIFICAME_PROVIDER = "notificame" as const;

/**
 * Teto DURO do envio. Edge function tem tempo de vida limitado e um `fetch`
 * pendurado consome o worker inteiro.
 *
 * ⚠️ Estourar o deadline é "NÃO SEI", jamais "não enviou": a requisição pode ter
 * chegado. Por isso o timeout tem código PRÓPRIO (`send_timeout`) e NADA é
 * gravado — gravar como 'sent' seria inventar entrega, e gravar como 'failed'
 * convidaria o operador a reenviar uma mensagem que já saiu.
 */
export const SEND_TIMEOUT_MS = 20_000;

/** Tipos de canal que este provider sabe enviar. Fechado por construção. */
export type NotificameChannelKind = "whatsapp" | "instagram";

// ─── Rota (puro) ─────────────────────────────────────────────────────────────

/**
 * A rota de envio do canal. PURO.
 *
 * DUAS rotas e não uma com parâmetro: `/v2/channels/whatsapp/messages` e
 * `/v2/channels/instagram/messages` são endpoints distintos do fornecedor, e
 * mandar um envelope de Instagram para a rota de WhatsApp devolve `Hub404` —
 * HTTP **200** com erro dentro, o caso que `parseNotificameBody` existe para pegar.
 */
export function notificameSendPath(kind: NotificameChannelKind): string {
  return `/v2/channels/${kind}/messages`;
}

// ─── Conteúdo e envelope (puro) ──────────────────────────────────────────────

export interface NotificameContent {
  type: string;
  [key: string]: unknown;
}

export interface NotificameEnvelope {
  /** O id do CANAL no fornecedor. Não é telefone, não é a subconta. */
  from: string;
  to: string;
  contents: NotificameContent[];
}

/**
 * O envelope de saída. PURO.
 *
 * `contents` é ARRAY porque o fornecedor o define assim — mesmo com um item só.
 * Achatar para objeto é a variação óbvia e ela devolve erro de shape.
 *
 * ⚠️ `from` é o **id do canal**, não o número. Passar o telefone aqui produz
 * `Hub404`/`ERROR` com HTTP 200 — falha que parece sucesso para quem lê status.
 */
export function buildNotificameEnvelope(params: {
  from: string;
  to: string;
  content: NotificameContent;
}): NotificameEnvelope {
  return { from: params.from, to: params.to, contents: [params.content] };
}

/**
 * Normaliza o destinatário conforme o canal. PURO.
 *
 * WhatsApp → só dígitos (o hub carrega telefone E.164 sem enfeite; `+`, espaço e
 * parêntese vindos do compositor viram destinatário inválido).
 *
 * Instagram → **cru**. O IGSID é um identificador opaco; aplicar `\D` a ele hoje
 * funciona por acidente (é numérico) e quebraria em silêncio no dia em que o
 * fornecedor devolver um id alfanumérico — com o agravante de que o valor
 * normalizado vira `contact_external_id` e passaria a agrupar a conversa errada.
 */
export function normalizeNotificameRecipient(
  kind: NotificameChannelKind,
  raw: string,
): string {
  const value = String(raw ?? "").trim();
  return kind === "whatsapp" ? value.replace(/\D/g, "") : value;
}

/**
 * Traduz a mídia unificada para o `content` do hub. PURO.
 *
 * ─── O CONTRATO, E POR QUE ELE NÃO É O ÓBVIO ────────────────────────────────
 *
 * TODA mídia — áudio, imagem, vídeo, documento — viaja no MESMO formato, e o
 * discriminador não é o `type`:
 *
 *     { "type": "file", "fileMimeType": "audio", "fileUrl": "…", "fileCaption": "…" }
 *
 * `type` é sempre `"file"`; quem diz o que é a mídia é `fileMimeType`. Duas
 * fontes do fornecedor concordam byte a byte: a doc (`app.notificame.com.br/
 * docs/api.md`) e o node oficial `n8n-nodes-notificame-hub@0.3.3`
 * (`transport/{instagram,whatsapp}/Enviar{Arquivo,MensagemAudio}.transport.js`).
 *
 * A forma INTUITIVA — `{ type:"image", url, caption }` — é a que estava aqui, e
 * ela não falha alto: o fornecedor aceita o corpo e recusa o ENVIO. Em produção
 * (17/08/2026) isso apareceu como áudio e imagem recusados no Direct enquanto o
 * texto passava, com a recusa chegando ao operador sem motivo.
 *
 * ─── AS DUAS ASSIMETRIAS ENTRE CANAIS ───────────────────────────────────────
 *
 *   • `voice: true` faz o áudio chegar como GRAVAÇÃO em vez de arquivo anexo —
 *     e existe SÓ no WhatsApp. A doc não o traz em Instagram, Facebook, Telegram
 *     nem Mercado Livre. No Direct, `fileMimeType:"audio"` é o mais nativo que o
 *     contrato oferece; mandar `voice` ali seria inventar campo.
 *
 *   • `document` existe no WhatsApp e NÃO no Instagram (o node oferece
 *     Documento/Imagem/Vídeo num, só Imagem/Vídeo no outro). Recusamos aqui pelo
 *     mesmo motivo que `sendTemplate` recusa: erro nosso e legível, antes do I/O,
 *     em vez da recusa opaca do fornecedor depois.
 *
 * ⚠️ LANÇA `NotSupportedError` também em dois casos antigos, ambos deliberados:
 *
 *   • **base64** — o hub referencia mídia por URL pública; não há rota de upload
 *     no contrato do canal. Aceitar base64 e mandar a string como URL produziria
 *     uma mensagem que o fornecedor aceita e o destinatário nunca vê.
 *
 *   • **sticker** — o canal oficial não tem figurinha. Mapear para `image` seria
 *     ADIVINHAR: o destinatário receberia um quadrado estático no lugar do que o
 *     operador escolheu, sem ninguém saber por quê.
 */
export function toNotificameMediaContent(
  opts: SendMediaOptions,
  kind: NotificameChannelKind,
): NotificameContent {
  const file = String(opts.file ?? "").trim();

  if (!/^https?:\/\//i.test(file)) {
    throw new NotSupportedError(
      NOTIFICAME_PROVIDER,
      "sendMedia com arquivo embutido (base64) — o canal oficial exige URL pública",
    );
  }

  const caption = opts.caption?.trim() ? opts.caption : undefined;

  /** O envelope comum. `fileCaption` só entra quando há o que dizer. */
  const arquivo = (
    fileMimeType: "image" | "video" | "audio" | "document",
    legenda?: string,
  ): NotificameContent => ({
    type: "file",
    fileMimeType,
    fileUrl: file,
    ...(legenda ? { fileCaption: legenda } : {}),
  });

  switch (opts.type) {
    case "image":
      return arquivo("image", caption);
    case "video":
      return arquivo("video", caption);
    case "audio":
    case "ptt": {
      // `ptt` (push-to-talk) não tem discriminador próprio no hub: é áudio, e no
      // WhatsApp é `voice` que carrega a intenção de "gravado agora".
      // "Áudio" como legenda é literal do node oficial, nos dois canais.
      //
      // ⚠️ `voice: true` SÓ EM `ptt`. A Cloud API exige .ogg/OPUS para nota de
      // voz; marcar `voice` sobre um m4a fez a Meta recusar em produção
      // (2026-08-19) com `131053 Media upload error — uploaded with mimetype as
      // audio/mp4, however on processing it is of type application/octet-stream`.
      // O envio síncrono devolveu `queued` e o Torque exibiu "enviado": a recusa
      // veio 2s depois, por callback. Quem escolhe entre os dois é o chamador,
      // que conhece o MIME real do arquivo — aqui `audio` significa áudio comum.
      const conteudo = arquivo("audio", caption ?? "Áudio");
      return kind === "whatsapp" && opts.type === "ptt"
        ? { ...conteudo, voice: true }
        : conteudo;
    }
    case "document":
      if (kind !== "whatsapp") {
        throw new NotSupportedError(
          NOTIFICAME_PROVIDER,
          `sendMedia(document) — o canal ${kind} não aceita documento, só imagem, vídeo e áudio`,
        );
      }
      // O contrato não tem campo para o NOME do arquivo. Sem legenda própria, o
      // nome vira a legenda: é escolha nossa, e é melhor que o destinatário
      // receber um anexo sem identificação nenhuma.
      return arquivo("document", caption ?? opts.filename);
    case "sticker":
      throw new NotSupportedError(NOTIFICAME_PROVIDER, "sendMedia(sticker)");
    default:
      throw new NotSupportedError(
        NOTIFICAME_PROVIDER,
        `sendMedia(${String((opts as { type?: unknown }).type)})`,
      );
  }
}

// ─── O id da mensagem enviada (puro) ─────────────────────────────────────────

/**
 * Extrai o id que o fornecedor deu à mensagem. PURO. Devolve `null` quando não há.
 *
 * TOLERANTE EM ALIAS, INTOLERANTE EM AUSÊNCIA — a mesma assimetria de
 * `normalizeChannel`, e pelo mesmo motivo: o shape da resposta de envio é
 * DERIVADO DE DOC (nenhum canal estava conectado), então cobrir as variações
 * plausíveis custa nada; inventar um id custa a rastreabilidade inteira da
 * conversa (ver o cabeçalho, defeito de `send-meta-message` L137).
 *
 * `null` NUNCA pode virar fallback. Quem chama transforma em erro.
 */
/**
 * Traduz os componentes de template do formato da GRAPH (o que
 * `SendTemplateOptions.components` carrega, porque o caminho meta_cloud repassa
 * cru) para o formato deste módulo.
 *
 * Duas diferenças reais, e as duas calam se ignoradas: a Graph usa `sub_type`
 * em snake_case e a posição do botão vem como número ou string. O builder exige
 * `subType` e converte a posição — e `index: 0` é POSIÇÃO VÁLIDA, então o teste
 * aqui é por `undefined`/`null`, nunca por falsy: um check ingênuo recusaria o
 * primeiro botão de todo template.
 *
 * O que não reconhece, NÃO inventa: componente sem `type` legível vira erro
 * explícito, porque template com componente faltando é recusado pela Meta e a
 * mensagem some — falha tardia e cara, no lugar de uma falha aqui.
 */
/**
 * Um parâmetro da Graph no formato INTERNO.
 *
 * ⚠️ MÍDIA MUDA DE FORMA ENTRE OS DOIS. Na Graph o link vem ANINHADO sob a chave
 * do tipo — `{type:"image", image:{link}}` —, e o nosso `TemplateSendParameter`
 * o quer PLANO — `{type:"image", link}`. `buildSendParameter` lê `p.link`, e o
 * repasse cru fazia esse campo chegar `undefined`: o JSON some com a chave e o
 * envelope sai como `{"type":"image","image":{}}`.
 *
 * A Meta responde a isso com
 *
 *   132018 There's an issue with the parameters in your template
 *   details: Either one of media ID or link must be present
 *
 * medido em produção 2026-08-19 — o segundo erro do mesmo template, depois de o
 * primeiro (132012, componente ausente) já ter sido corrigido.
 *
 * Aceita as DUAS formas: quem já manda plano continua funcionando, e quem manda
 * no formato documentado pela Meta passa a funcionar.
 */
function normalizarParametro(bruto: unknown): TemplateSendParameter {
  const p = (bruto ?? {}) as Record<string, unknown>;
  const tipo = String(p.type ?? "").toLowerCase();

  if (tipo === "image" || tipo === "video" || tipo === "document") {
    const aninhado = (p[tipo] ?? {}) as Record<string, unknown>;
    const link = typeof p.link === "string" && p.link
      ? p.link
      : typeof aninhado.link === "string"
        ? aninhado.link
        : "";
    return { type: tipo, link } as TemplateSendParameter;
  }

  return p as TemplateSendParameter;
}

export function graphComponentsToTemplateComponents(
  components: unknown[] | undefined,
): TemplateSendComponent[] {
  if (!Array.isArray(components)) return [];

  return components.map((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const type = String(c.type ?? "").toLowerCase();

    if (type !== "header" && type !== "body" && type !== "footer" && type !== "button") {
      throw new NotificameError(
        "template_component_type_invalid",
        `Componente ${i} do template tem tipo desconhecido`,
      );
    }

    const out: TemplateSendComponent = { type };

    if (type === "button") {
      const subType = c.subType ?? c.sub_type;
      if (subType !== undefined && subType !== null) {
        out.subType = String(subType) as TemplateSendComponent["subType"];
      }
      // `0` é posição válida — comparar com undefined/null, jamais por falsy.
      if (c.index !== undefined && c.index !== null) {
        out.index = c.index as string | number;
      }
    }

    // `parameters: []` é LEGÍTIMO (template sem variável) e diferente de ausente:
    // o builder emite a chave nos dois casos, e a Meta espera isso.
    if (Array.isArray(c.parameters)) {
      out.parameters = (c.parameters as unknown[]).map(normalizarParametro);
    }

    return out;
  });
}

export function readSentMessageId(value: unknown): string | null {
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): string | null => {
    if (depth > 4 || node === null || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const obj = node as Record<string, unknown>;
    for (const key of ["id", "message_id", "messageId", "messageID", "uuid"]) {
      const raw = obj[key];
      if (typeof raw === "string" && raw.trim()) return raw.trim();
      if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    }

    // Envelopes conhecidos por doc/SDK. Ordem = do mais específico ao mais genérico.
    for (const key of ["message", "data", "result", "messages", "contents"]) {
      const child = obj[key];
      if (child && typeof child === "object") {
        const found = walk(child, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  return walk(value, 0);
}

// ─── A linha de `channel_messages` (puro) ────────────────────────────────────

/**
 * O recorte de `channel_messages` que o ENVIO escreve. Declarado aqui, e não
 * importado de `src/integrations/supabase/types.ts`, porque edge function não
 * enxerga `src/` — e porque `contact_external_id` / `messaging_channel_id` só
 * existem em types.ts depois do regen.
 */
export interface OutboundChannelMessageRow {
  organization_id: string;
  channel: NotificameChannelKind;
  instance_id: string | null;
  messaging_channel_id: string | null;
  contact_external_id: string;
  external_id: string;
  direction: "outgoing";
  message_type: string;
  content: string | null;
  media_url: string | null;
  status: "sent";
  sender_id: null;
  sender_name: null;
  sender_profile_pic: null;
  remote_jid: null;
  phone_number: string | null;
  page_id: null;
  lead_id: null;
  timestamp: string;
  raw_payload: unknown;
  /**
   * A forma NOSSA do que foi enviado. Hoje só carrega os rótulos dos botões de
   * um template — que a Meta renderiza do lado dela e que, sem isto, não
   * aparecem em lugar nenhum da conversa.
   *
   * `null` quando não há nada a dizer: um `{}` faria a bolha desenhar uma faixa
   * vazia debaixo da mensagem.
   */
  metadata: unknown | null;
}

/**
 * Monta a linha de saída. PURO — recebe tudo já decidido, inclusive o instante.
 *
 * ⚠️ `direction: 'outgoing'` é LITERAL. O CHECK `channel_messages_direction_check`
 * aceita `('incoming','outgoing')` e nada mais; `'outbound'` — a palavra que o
 * vocabulário do fornecedor usa — violaria o CHECK e derrubaria a gravação
 * DEPOIS de a mensagem já ter saído. É o espelho exato do aviso que
 * `buildInboundChannelMessageRow` carrega sobre `'inbound'`.
 *
 * ⚠️ `contact_external_id` é o DESTINATÁRIO, porque é o INTERLOCUTOR — a mesma
 * coluna que no inbound carrega o remetente. É essa simetria que faz a mensagem
 * enviada aparecer na thread. O defeito a não copiar é `useMetaMessages`, que
 * casa por `sender_id = external_user_id`: na saída o `sender_id` é a NOSSA
 * conta, então a mensagem enviada nunca aparece na conversa.
 *
 * ⚠️ `sender_id: null`, e não o destinatário. `send-meta-message` grava o
 * destinatário em `sender_id` para fazer aquela query casar — o que transforma a
 * coluna "quem mandou" em mentira. Quem agrupa é `contact_external_id`; a coluna
 * de remetente fica vazia porque quem mandou fomos nós, e nós não somos um
 * contato.
 *
 * ⚠️ `phone_number` só existe para WhatsApp. Em Instagram é `null` — NUNCA `''` e
 * NUNCA o handle: `normalizePhone('')` devolve `''`, `''` casa com `''`, e todos
 * os contatos de Instagram da org colapsariam num contato só. Dois caminhos
 * EXECUTAM esse campo (`formatPhoneForWhatsApp`, `LeadContactModal`).
 *
 * ⚠️ `raw_payload` guarda o envelope ENVIADO e o corpo RECEBIDO. Nenhum dos dois
 * carrega credencial: o token vai no header `X-Api-Token` e não entra no corpo.
 * É o que vai ensinar o formato real da resposta no primeiro envio de verdade —
 * exatamente o que faltou para escrever `readSentMessageId` com certeza.
 */
export function buildOutboundChannelMessageRow(params: {
  organizationId: string;
  channelKind: NotificameChannelKind;
  instanceId: string | null;
  messagingChannelId: string | null;
  contactExternalId: string;
  externalId: string;
  messageType: string;
  content: string | null;
  mediaUrl: string | null;
  timestampIso: string;
  rawPayload: unknown;
  /**
   * Os rótulos dos botões do template, na ordem — vindos de QUEM ENVIA.
   *
   * Mesmo motivo do `previewText`: a Meta monta a mensagem do lado dela, e só
   * quem clicou em enviar tem o template aprovado em mãos. Inventar aqui faria
   * o histórico mentir sobre o que o cliente viu.
   */
  botoes?: string[];
}): OutboundChannelMessageRow {
  return {
    organization_id: params.organizationId,
    channel: params.channelKind,
    instance_id: params.instanceId,
    messaging_channel_id: params.messagingChannelId,
    contact_external_id: params.contactExternalId,
    external_id: params.externalId,
    direction: "outgoing",
    message_type: params.messageType,
    content: params.content,
    media_url: params.mediaUrl,
    status: "sent",
    sender_id: null,
    sender_name: null,
    sender_profile_pic: null,
    remote_jid: null,
    phone_number: params.channelKind === "whatsapp" ? params.contactExternalId : null,
    page_id: null,
    lead_id: null,
    timestamp: params.timestampIso,
    raw_payload: params.rawPayload,
    metadata: params.botoes?.length
      ? { tipo: "template", botoes: params.botoes }
      : null,
  };
}

// ─── O provider ──────────────────────────────────────────────────────────────

export interface NotificameProviderOptions {
  /** Vem SEMPRE do contexto de auth validado / da linha do banco — nunca do body. */
  organizationId: string;
  /** O id do canal NO FORNECEDOR. Vira `from` no envelope. */
  channelId: string;
  channelKind: NotificameChannelKind;
  supabaseAdmin: SupabaseClient;
  /**
   * O uuid da linha de `notificame_subaccounts` que a linha do canal DIZ ser a
   * dona. Quando presente é comparado contra a subconta que o cofre devolve para
   * `organizationId` — ver `resolveOrgConfig`.
   */
  expectedSubaccountId?: string | null;
  /** `whatsapp_instances.id` — só canal de WhatsApp. Vai para `channel_messages.instance_id`. */
  instanceId?: string | null;
  /** `messaging_channels.id` — só canal social. Vai para `channel_messages.messaging_channel_id`. */
  messagingChannelId?: string | null;
  /** Injetáveis para teste. Em produção saem de `Deno.env` e do `fetch` global. */
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  encryptionKeyHex?: string;
  now?: () => Date;
}

export class NotificameProvider implements WhatsAppProvider {
  readonly provider = NOTIFICAME_PROVIDER;

  private readonly organizationId: string;
  private readonly channelId: string;
  private readonly channelKind: NotificameChannelKind;
  private readonly supabaseAdmin: SupabaseClient;
  private readonly expectedSubaccountId: string | null;
  private readonly instanceId: string | null;
  private readonly messagingChannelId: string | null;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private readonly encryptionKeyHex?: string;
  private readonly now: () => Date;

  /** Memoiza o token por instância do provider: texto + mídia no mesmo turno = uma decifragem. */
  private cfgPromise: Promise<NotificameOrgConfig> | null = null;

  constructor(options: NotificameProviderOptions) {
    this.organizationId = options.organizationId;
    this.channelId = options.channelId;
    this.channelKind = options.channelKind;
    this.supabaseAdmin = options.supabaseAdmin;
    this.expectedSubaccountId = options.expectedSubaccountId ?? null;
    this.instanceId = options.instanceId ?? null;
    this.messagingChannelId = options.messagingChannelId ?? null;
    this.baseUrl = options.baseUrl ?? readEnvBaseUrl();
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.encryptionKeyHex = options.encryptionKeyHex;
    this.now = options.now ?? (() => new Date());
  }

  // ── Credencial (lazy, fail-closed) ────────────────────────────────────────
  private resolveOrgConfig(): Promise<NotificameOrgConfig> {
    if (!this.cfgPromise) {
      this.cfgPromise = this.loadOrgConfig().catch((e) => {
        // Zera para que uma falha transitória possa ser retentada no próximo envio.
        this.cfgPromise = null;
        throw e;
      });
    }
    return this.cfgPromise;
  }

  /**
   * Lê o token da SUBCONTA daquela org e monta a config de operação.
   *
   * ⚠️ A subconta é buscada POR `organization_id`, nunca pelo id que a linha do
   * canal carrega. Inverter isso é o que fabrica o envio cross-tenant: um
   * `provider_config.subaccount_id` adulterado (jsonb que qualquer caminho de
   * escrita futuro pode tocar) escolheria o cofre de OUTRA org e a mensagem
   * sairia pelo canal dela. Aqui o `subaccount_id` da linha só serve de
   * CONFERÊNCIA — se ele discordar do cofre da org, o envio para.
   */
  private async loadOrgConfig(): Promise<NotificameOrgConfig> {
    // `encryptionKeyHex` undefined cai no default do módulo do cofre (`Deno.env`).
    const sub = await loadNotificameSubaccount(
      this.supabaseAdmin,
      this.organizationId,
      this.encryptionKeyHex,
    );

    if (!sub) {
      throw new NotificameError(
        "subaccount_not_ready",
        "A conta do NotificaMe desta organização não está pronta",
      );
    }

    if (this.expectedSubaccountId && this.expectedSubaccountId !== sub.id) {
      throw new NotificameError(
        "subaccount_mismatch",
        "O canal aponta para uma conta do NotificaMe que não é a desta organização",
      );
    }

    return orgConfigFrom(this.baseUrl, sub.companyUuid);
  }

  // ── Envio (o coração) ─────────────────────────────────────────────────────

  /**
   * Manda UM content e devolve o id REAL. Nunca inventa, nunca lê `res.ok`.
   *
   * Ordem das decisões, toda ela load-bearing:
   *   1. destinatário vazio       → para antes de gastar uma chamada;
   *   2. token da subconta        → do cofre, por org;
   *   3. POST com deadline duro   → abort deixa "não sei", com código próprio;
   *   4. `parseNotificameBody`    → veredito pelo CORPO;
   *   5. `readSentMessageId`      → sem id, ERRO. Nada é gravado;
   *   6. `channel_messages`       → best-effort, DEPOIS de o envio ser fato.
   */
  private async send(params: {
    to: string;
    content: NotificameContent;
    messageType: string;
    text: string | null;
    mediaUrl: string | null;
    /** Só em template: os rótulos dos botões, para a conversa poder exibi-los. */
    botoes?: string[];
  }): Promise<SendResult> {
    const to = normalizeNotificameRecipient(this.channelKind, params.to);
    if (!to) {
      throw new NotificameError(
        "invalid_recipient",
        "Destinatário vazio ou inválido para o canal do NotificaMe",
      );
    }

    const cfg = await this.resolveOrgConfig();
    const envelope = buildNotificameEnvelope({
      from: this.channelId,
      to,
      content: params.content,
    });

    const url = `${cfg.baseUrl}${notificameSendPath(this.channelKind)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    let rawText: string;
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          // A ÚNICA credencial da chamada, e ela é da SUBCONTA. Não vai na URL,
          // não vai no corpo, não é logada.
          "X-Api-Token": cfg.subaccountToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      rawText = await res.text();
    } catch (err) {
      // Abort ou transporte quebrado. "NÃO SEI" — nunca "não enviou". Nada é
      // gravado justamente porque a requisição pode ter chegado.
      const aborted = (err as { name?: string })?.name === "AbortError";
      throw new NotificameError(
        aborted ? "send_timeout" : "send_transport_error",
        aborted
          ? "O NotificaMe não respondeu a tempo — o envio pode ou não ter saído"
          : "Não foi possível falar com o NotificaMe para enviar a mensagem",
      );
    } finally {
      clearTimeout(timer);
    }

    const parsed = parseNotificameBody(rawText);
    if (!parsed.ok) {
      // A prosa do fornecedor NÃO atravessa a MENSAGEM: `withErrorBoundary`
      // devolve `error.message` cru no corpo do 500, e texto de terceiro ali é
      // vazamento. Ela viaja no campo `vendor`, que é server-only e existe para
      // exatamente isto — quem loga decide se grava.
      //
      // Sem este terceiro argumento, toda recusa do fornecedor chegava ao log
      // como a mesma frase sem motivo, e foi assim que o envelope de mídia
      // errado sobreviveu: o servidor sabia por que, e jogava fora.
      throw new NotificameError(
        parsed.code,
        "O NotificaMe recusou o envio da mensagem",
        vendorDetailFromParse(parsed),
      );
    }

    const messageId = readSentMessageId(parsed.value);
    if (!messageId) {
      throw new NotificameError(
        "send_no_message_id",
        "O NotificaMe respondeu sem id da mensagem — o envio não pôde ser confirmado",
      );
    }

    await this.persist({
      to,
      externalId: messageId,
      messageType: params.messageType,
      content: params.text,
      mediaUrl: params.mediaUrl,
      botoes: params.botoes,
      rawPayload: { request: envelope, response: parsed.value },
    });

    return { message_id: messageId, status: "sent", timestamp: this.now().getTime() };
  }

  /**
   * Grava/atualiza a linha de saída. BEST-EFFORT, e a assimetria é deliberada.
   *
   * Aqui a mensagem JÁ SAIU e já tem id do fornecedor. Transformar uma falha de
   * banco em erro de envio faria o operador reenviar algo que o cliente já
   * recebeu. O prejuízo real de uma gravação perdida é a linha faltando na
   * thread — recuperável, e barulhento no log.
   *
   * `upsert` em `(external_id, channel, organization_id)` SEM `ignoreDuplicates`:
   * a segunda tentativa do MESMO id é a mesma mensagem, e atualizar é o
   * comportamento certo (o inbound usa `ignoreDuplicates` porque lá reentrega é o
   * caminho feliz e não há nada novo a escrever).
   */
  private async persist(params: {
    to: string;
    externalId: string;
    messageType: string;
    content: string | null;
    mediaUrl: string | null;
    rawPayload: unknown;
    botoes?: string[];
  }): Promise<void> {
    const row = buildOutboundChannelMessageRow({
      organizationId: this.organizationId,
      channelKind: this.channelKind,
      instanceId: this.instanceId,
      messagingChannelId: this.messagingChannelId,
      contactExternalId: params.to,
      externalId: params.externalId,
      messageType: params.messageType,
      content: params.content,
      mediaUrl: params.mediaUrl,
      botoes: params.botoes,
      // O relógio mora AQUI, fora dos módulos puros.
      timestampIso: this.now().toISOString(),
      rawPayload: params.rawPayload,
    });

    try {
      const { error } = await (this.supabaseAdmin as any)
        .from("channel_messages")
        .upsert(row, { onConflict: "external_id,channel,organization_id" });
      if (error) {
        console.error(
          `[notificame] envio gravado no fornecedor mas NÃO no banco: channel=${this.channelKind} external_id=${params.externalId} err=${error.message}`,
        );
      }
    } catch (err) {
      console.error(
        `[notificame] envio gravado no fornecedor mas NÃO no banco: channel=${this.channelKind} external_id=${params.externalId} err=${(err as Error)?.message}`,
      );
    }
  }

  async sendText(opts: SendTextOptions): Promise<SendResult> {
    const text = String(opts.text ?? "");
    if (!text.trim()) {
      throw new NotificameError("empty_text", "Mensagem de texto vazia");
    }
    return await this.send({
      to: opts.number,
      content: { type: "text", text },
      messageType: "text",
      text,
      mediaUrl: null,
    });
  }

  /**
   * Envio de TEMPLATE — a única saída para falar fora da janela de 24h.
   *
   * É a válvula de escape que a regra P5 do `send-governor` pressupõe: ela
   * bloqueia texto livre de automação fora da janela justamente porque o
   * caminho correto é este. Sem `sendTemplate` ligado, a regra vira beco sem
   * saída, e automação em canal oficial com janela fechada não tem por onde
   * sair.
   *
   * SÓ WHATSAPP. Template é conceito da WhatsApp Business Platform; o
   * Instagram não tem equivalente e recusar aqui é melhor que deixar o
   * fornecedor recusar depois, com mensagem dele em vez de nossa.
   */
  async sendTemplate(opts: SendTemplateOptions): Promise<SendResult> {
    if (this.channelKind !== "whatsapp") {
      throw new NotSupportedError(NOTIFICAME_PROVIDER, "sendTemplate (instagram)");
    }

    // `buildTemplateSendContent` valida nome, idioma e a forma dos botões, e
    // lança NotificameError com código estável. Deixamos ele validar — duas
    // validações do mesmo contrato divergem.
    const content = buildTemplateSendContent({
      name: opts.templateName,
      languageCode: opts.language,
      components: graphComponentsToTemplateComponents(opts.components),
    }) as NotificameContent;

    return await this.send({
      to: opts.number,
      content,
      messageType: "template",
      // ⚠️ O TEXTO VEM DE QUEM ENVIA, e essa distinção é a única que importa aqui.
      //
      // A Meta monta o corpo final a partir do nome e dos parâmetros; deste lado
      // não há como INVENTÁ-LO — e inventar faria o histórico mentir sobre o que
      // o cliente recebeu. Mas quem clicou em enviar tem as duas metades: o corpo
      // APROVADO, que veio da listagem do fornecedor, e os parâmetros que ele
      // mesmo preencheu. Substituir um no outro reproduz o que a Meta renderiza —
      // não é chute, é a mesma conta.
      //
      // Sem isto a linha nasce sem texto e a conversa exibe "Mensagem interativa"
      // no lugar da mensagem — medido em produção no primeiro template enviado.
      text: opts.previewText?.trim() || null,
      mediaUrl: null,
      // Os rótulos dos botões, pelo MESMO motivo do texto acima: a Meta desenha
      // a faixa de botões do lado dela, e sem isto a conversa mostra o texto e
      // esconde as opções que o cliente está vendo.
      botoes: opts.buttonLabels?.map((r) => r.trim()).filter(Boolean),
    });
  }

  async sendMedia(opts: SendMediaOptions): Promise<SendResult> {
    // Lança NotSupportedError para base64, sticker e documento-no-Instagram —
    // ANTES de qualquer I/O. O canal decide o envelope: `voice` é do WhatsApp.
    const content = toNotificameMediaContent(opts, this.channelKind);
    return await this.send({
      to: opts.number,
      content,
      messageType: opts.type,
      text: opts.caption?.trim() ? opts.caption : null,
      // `fileUrl` é o campo do contrato; `url` era o nome que nunca existiu e
      // deixava `media_url` nulo na linha gravada mesmo quando havia mídia.
      mediaUrl: String(content.fileUrl ?? "") || null,
    });
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /**
   * Resolve o estado do canal por `GET /v1/channels` (já escopado à subconta) e
   * procura O NOSSO id.
   *
   * DEGRADA, nunca lança: `getStatus` é chamado por telas de listagem, e um
   * throw ali derruba o card inteiro. Canal ausente da lista vira
   * `disconnected` — que é a verdade quando o cliente removeu a permissão do
   * lado da Meta.
   */
  async getStatus(): Promise<InstanceStatus> {
    try {
      const cfg = await this.resolveOrgConfig();
      const channels = await listChannels(cfg, this.fetchImpl);
      const mine = channels.find((c) => c.id === this.channelId);
      if (!mine) return { connected: false, state: "disconnected" };

      const status = (mine.status ?? "").trim().toLowerCase();
      // Vocabulário de status do fornecedor não é contratual: qualquer coisa que
      // não seja explicitamente ruim conta como conectada — o canal ESTÁ na lista.
      const bad = status === "disconnected" || status === "inactive" || status === "error";
      const digits = (mine.phone ?? "").replace(/\D/g, "");
      return {
        connected: !bad,
        state: bad ? "disconnected" : "connected",
        owner: digits || undefined,
      };
    } catch {
      return { connected: false, state: "unknown" };
    }
  }

  // ── setPresence — NO-OP ───────────────────────────────────────────────────
  /**
   * O canal oficial não tem "digitando…". NÃO LANÇA de propósito: o Copilot chama
   * `setPresence` ANTES de todo envio, e um throw aqui mataria o envio inteiro por
   * causa de um indicador cosmético. Mesmo desfecho do `MetaCloudProvider`.
   */
  setPresence(_number: string, _state: "composing" | "available"): Promise<void> {
    return Promise.resolve();
  }

  // ── Ciclo de vida da conexão ──────────────────────────────────────────────
  // O canal nasce e morre no popup do Seamless / no painel da Meta. Nada disso
  // tem endpoint nosso, e fingir que tem daria um botão que não faz nada.

  createInstance(_input: CreateInstanceInput): Promise<CreateInstanceResult> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "createInstance (use o popup do Seamless)");
  }

  connectQR(_phone?: string): Promise<{ qrcode?: string; paircode?: string }> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "connectQR (canal oficial não tem QR)");
  }

  deleteInstance(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "deleteInstance (gerenciado pelo NotificaMe)");
  }

  logoutInstance(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "logoutInstance (gerenciado pelo NotificaMe)");
  }

  /**
   * O hub entrega mídia de entrada como URL no próprio payload — não há id de
   * mídia para trocar por bytes. Um download aqui precisaria adivinhar rota.
   */
  downloadMedia(_messageId: string): Promise<{ base64: string; mimetype: string }> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "downloadMedia");
  }

  // ── Capacidades que o canal oficial NÃO tem (cert Rule 7) ─────────────────
  // Cada mensagem contém "does not support" — a string que `isFeatureUnavailable()`
  // casa para mostrar o toast certo em vez de um 500 cru.

  sendMenu(): Promise<SendResult> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "sendMenu");
  }

  sendPixButton(): Promise<SendResult> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "sendPixButton");
  }

  react(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "react");
  }

  edit(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "edit");
  }

  pin(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "pin");
  }

  deleteForAll(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "deleteForAll");
  }

  markRead(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "markRead");
  }

  listChats(): Promise<Array<{ id: string; name?: string; isGroup?: boolean; lastMessageTimestamp?: number }>> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "listChats");
  }

  historySync(): Promise<{ messages: unknown[]; nextCursor?: string }> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "historySync");
  }

  getMessageLimits(): Promise<{ current: number; limit: number; reachout_timelock?: number }> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "getMessageLimits");
  }

  // Disparo em massa: as rotas `/sender/*` são da Uazapi e não existem no hub.
  // Independente disso, o portão de dispatch (`whatsapp-dispatch.ts`,
  // `instances-to-numbers.ts`) já EXCLUI notificame por allowlist — e continua
  // excluindo até a frente da janela de 24h existir.

  senderAdvanced(): Promise<never> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "senderAdvanced");
  }

  senderGet(): Promise<never> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "senderGet");
  }

  senderListMessages(): Promise<never> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "senderListMessages");
  }

  senderPause(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "senderPause");
  }

  senderResume(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "senderResume");
  }

  senderStop(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "senderStop");
  }
}

// ─── Factory do canal SOCIAL ─────────────────────────────────────────────────

/**
 * Constrói o provider para um canal de `messaging_channels` (Instagram).
 *
 * ⚠️ POR QUE UMA FACTORY SEPARADA E NÃO `getWhatsAppProvider`: canal social NÃO
 * TEM LINHA em `whatsapp_instances`, e é essa ausência que é o isolamento
 * (decisão A.7, `20270814093000`). `getWhatsAppProvider` recebe um
 * `WhatsAppInstance`; alargá-lo para aceitar canal social exigiria uma linha
 * naquela tabela — a linha que 13 superfícies de front leem como "um número".
 * Duas portas de entrada é o preço de não ter essa linha, e é barato.
 *
 * `facebook` está FORA do tipo de propósito: existe no CHECK de
 * `messaging_channels.channel_type`, mas nenhum caminho o liga, e a rota de
 * envio dele (`/v2/channels/facebook/messages`) nunca foi exercida.
 *
 * A linha do canal é lida por `id` **e** `organization_id`: o org vem do contexto
 * de auth validado, e sem esse segundo filtro um id de canal de outro tenant
 * montaria um provider que envia pela conta alheia. O `subaccount_id` da linha
 * vira CONFERÊNCIA contra o cofre daquela org, nunca o seletor dele.
 */
export async function getNotificameSocialProvider(
  supabaseAdmin: SupabaseClient,
  params: {
    organizationId: string;
    messagingChannelId: string;
    fetchImpl?: FetchImpl;
    baseUrl?: string;
  },
): Promise<NotificameProvider> {
  const { data, error } = await (supabaseAdmin as any)
    .from("messaging_channels")
    .select("id, organization_id, provider, channel_type, external_channel_id, subaccount_id, status")
    .eq("id", params.messagingChannelId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();

  if (error) {
    throw new NotificameError(
      "channel_lookup_failed",
      "Não foi possível carregar o canal social desta organização",
    );
  }

  const row = data as {
    id: string;
    organization_id: string;
    provider: string;
    channel_type: string;
    external_channel_id: string;
    subaccount_id: string;
  } | null;

  if (!row) {
    throw new NotificameError("channel_not_found", "Canal social não encontrado nesta organização");
  }
  if (row.provider !== NOTIFICAME_PROVIDER) {
    throw new NotificameError("channel_wrong_provider", "Canal social não é do NotificaMe");
  }
  if (row.channel_type !== "instagram") {
    // `facebook` cai aqui. Recusar é melhor que enviar por uma rota nunca exercida.
    throw new NotSupportedError(NOTIFICAME_PROVIDER, `envio em canal ${row.channel_type}`);
  }

  return new NotificameProvider({
    organizationId: row.organization_id,
    channelId: row.external_channel_id,
    channelKind: "instagram",
    expectedSubaccountId: row.subaccount_id,
    instanceId: null,
    messagingChannelId: row.id,
    supabaseAdmin,
    fetchImpl: params.fetchImpl,
    baseUrl: params.baseUrl,
  });
}

// ─── Utilitários internos ────────────────────────────────────────────────────

/**
 * Base do fornecedor a partir do ambiente. `Deno` pode não existir sob Vitest —
 * cair no default é correto ali, e em produção a env sempre responde.
 */
function readEnvBaseUrl(): string {
  const env = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
  if (!env) return NOTIFICAME_DEFAULT_BASE_URL;
  return readNotificameBaseUrl(env);
}
