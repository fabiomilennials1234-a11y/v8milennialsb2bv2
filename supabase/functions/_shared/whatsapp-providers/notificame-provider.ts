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
  type SendMenuOptions,
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
  /**
   * A mensagem CITADA, quando esta responde a outra.
   *
   * ⚠️ Mora na RAIZ, ao lado de `from`/`to`, e não dentro de `contents` — é a
   * única exceção ao padrão do contrato. Ver `montarEnvelopeDeResposta`.
   */
  messageId?: string;
  reply?: boolean;
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
/** Uma mensagem interativa, na forma NOSSA — antes de virar envelope. */
export interface NotificameInterativa {
  tipo: "button" | "list" | "cta" | "poll" | "carousel";
  texto: string;
  rodape?: string;
  opcoes: Array<{ titulo: string; descricao?: string }>;
  /** Só em `list`: o texto do botão que ABRE a lista. Sem ele ela não abre. */
  rotuloDaLista?: string;
  /** Só em `cta`: o endereço que o botão abre. */
  ctaUrl?: string;
}

/** Tetos da Meta. Ela recusa a mensagem inteira, não corta o excedente. */
const MAX_BOTOES_INTERATIVOS = 3;
const MAX_LINHAS_DA_LISTA = 10;

/**
 * O envelope de uma mensagem interativa. PURO.
 *
 * ⚠️ ESTE CAMINHO SÓ EXISTE DENTRO DA JANELA DE 24 HORAS. Fora dela a Meta
 * recusa qualquer mensagem livre, interativa ou não — o que passa ali é template
 * aprovado, e template tem botão próprio (`lib/template-buttons.ts`).
 *
 * ⚠️ RECUSA ALTO, ANTES DO I/O. A forma intuitiva não falha: o fornecedor aceita
 * o corpo e a Meta recusa o envio depois, e a recusa chega ao vendedor sem
 * motivo legível. Um erro nosso, aqui, diz o que fazer.
 *
 * ⚠️ Os ids são a POSIÇÃO. É o que volta no `postback`/`button_reply` quando o
 * cliente toca — e é por isso que o título vai junto: o id sozinho não diz nada
 * a quem lê a conversa depois.
 */
export function toNotificameInteractiveContent(
  i: NotificameInterativa,
  kind: NotificameChannelKind,
): NotificameContent {
  if (kind !== "whatsapp") {
    // A doc traz Quick Reply para Instagram, com envelope PRÓPRIO. Mandar o do
    // WhatsApp ali seria inventar campo — e o fornecedor aceitaria o corpo antes
    // de a Meta recusar o envio.
    throw new NotSupportedError(
      NOTIFICAME_PROVIDER,
      `mensagem interativa — o canal ${kind} tem envelope próprio, ainda não implementado`,
    );
  }

  const texto = (i.texto ?? "").trim();
  if (!texto) {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "mensagem interativa sem texto");
  }

  const opcoes = (i.opcoes ?? []).filter((o) => (o.titulo ?? "").trim() !== "");
  if (opcoes.length === 0) {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "mensagem interativa sem opção");
  }

  const rodape = (i.rodape ?? "").trim();

  switch (i.tipo) {
    case "button": {
      if (opcoes.length > MAX_BOTOES_INTERATIVOS) {
        throw new NotSupportedError(
          NOTIFICAME_PROVIDER,
          `mensagem com botões aceita no máximo ${MAX_BOTOES_INTERATIVOS} opções`,
        );
      }
      return {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: texto },
          ...(rodape ? { footer: { text: rodape } } : {}),
          action: {
            buttons: opcoes.map((o, n) => ({
              type: "reply",
              reply: { id: String(n + 1), title: o.titulo.trim() },
            })),
          },
        },
      };
    }

    case "list": {
      const rotulo = (i.rotuloDaLista ?? "").trim();
      if (!rotulo) {
        throw new NotSupportedError(
          NOTIFICAME_PROVIDER,
          "lista sem o texto do botão que a abre",
        );
      }
      if (opcoes.length > MAX_LINHAS_DA_LISTA) {
        throw new NotSupportedError(
          NOTIFICAME_PROVIDER,
          `lista aceita no máximo ${MAX_LINHAS_DA_LISTA} opções`,
        );
      }
      return {
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: texto },
          ...(rodape ? { footer: { text: rodape } } : {}),
          action: {
            button: rotulo,
            // Uma seção só: o envelope aceita várias, e agrupar exigiria uma
            // decisão de produto que ninguém pediu. "Opções" é rótulo neutro.
            sections: [
              {
                title: "Opções",
                rows: opcoes.map((o, n) => ({
                  id: String(n + 1),
                  title: o.titulo.trim(),
                  ...(o.descricao?.trim() ? { description: o.descricao.trim() } : {}),
                })),
              },
            ],
          },
        },
      };
    }

    case "cta": {
      const url = (i.ctaUrl ?? "").trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new NotSupportedError(NOTIFICAME_PROVIDER, "botão de link sem endereço válido");
      }
      return {
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: texto },
          ...(rodape ? { footer: { text: rodape } } : {}),
          action: {
            name: "cta_url",
            parameters: { display_text: opcoes[0].titulo.trim(), url },
          },
        },
      };
    }

    default:
      // Enquete e carrossel são vocabulário da Uazapi. A Meta não os tem, e
      // mapeá-los para lista entregaria ao cliente uma coisa no lugar de outra.
      throw new NotSupportedError(
        NOTIFICAME_PROVIDER,
        `mensagem interativa do tipo ${String(i.tipo)} não existe no canal oficial`,
      );
  }
}

/**
 * Uma localização, na forma nossa. `nome` e `endereco` são opcionais no
 * envelope, e mandá-los vazios põe uma linha em branco no cartão do aparelho.
 */
export interface NotificameLocalizacao {
  latitude: number;
  longitude: number;
  nome?: string;
  endereco?: string;
}

/**
 * O envelope de localização. PURO.
 *
 * ⚠️ OS CAMPOS FICAM NO NÍVEL DO CONTENT. A Graph aninha sob `location`, e a doc
 * do fornecedor NÃO — a forma aninhada é aceita por ele e recusada pela Meta
 * depois, com a recusa chegando ao vendedor sem motivo.
 */
export function toNotificameLocationContent(
  l: NotificameLocalizacao,
  kind: NotificameChannelKind,
): NotificameContent {
  if (kind !== "whatsapp") {
    throw new NotSupportedError(
      NOTIFICAME_PROVIDER,
      `localização — o canal ${kind} não a traz na doc`,
    );
  }
  // `0` é coordenada: a checagem é de finitude, e não um `!lat` que apagaria o
  // equador e o meridiano de Greenwich.
  if (!Number.isFinite(l.latitude) || !Number.isFinite(l.longitude)) {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "localização sem coordenada");
  }

  const nome = (l.nome ?? "").trim();
  const endereco = (l.endereco ?? "").trim();

  return {
    type: "location",
    latitude: l.latitude,
    longitude: l.longitude,
    ...(nome ? { name: nome } : {}),
    ...(endereco ? { address: endereco } : {}),
  };
}

/** Um cartão de contato, na forma nossa. */
export interface NotificameContato {
  nome: string;
  telefones: Array<{ numero: string; waId?: string }>;
  emails?: string[];
}

/**
 * O envelope de contato. PURO.
 *
 * ⚠️ `formatted_name` é o que o aparelho EXIBE, e a Meta o exige. `first_name` e
 * `last_name` saem da primeira e da última palavra — e `last_name` só entra
 * quando existe: um campo vazio no cartão aparece como linha em branco no
 * aparelho do destinatário.
 */
export function toNotificameContactContent(
  contatos: NotificameContato[],
  kind: NotificameChannelKind,
): NotificameContent {
  if (kind !== "whatsapp") {
    throw new NotSupportedError(
      NOTIFICAME_PROVIDER,
      `contato — o canal ${kind} não o traz na doc`,
    );
  }

  const usaveis = contatos.filter((c) =>
    (c.nome ?? "").trim() !== "" &&
    (c.telefones ?? []).some((t) => (t.numero ?? "").trim() !== "")
  );
  if (usaveis.length === 0) {
    // Um cartão sem telefone é um contato que não serve para nada: o
    // destinatário recebe um nome que não dá para chamar.
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "contato sem nome ou sem telefone");
  }

  return {
    type: "contacts",
    contacts: usaveis.map((c) => {
      const nome = c.nome.trim();
      const partes = nome.split(/\s+/);
      const sobrenome = partes.length > 1 ? partes[partes.length - 1] : "";
      const emails = (c.emails ?? []).map((e) => e.trim()).filter(Boolean);

      return {
        name: {
          formatted_name: nome,
          first_name: partes[0],
          ...(sobrenome ? { last_name: sobrenome } : {}),
        },
        phones: c.telefones
          .filter((t) => (t.numero ?? "").trim() !== "")
          .map((t) => ({
            phone: t.numero.trim(),
            ...(t.waId?.trim() ? { wa_id: t.waId.trim() } : {}),
          })),
        ...(emails.length ? { emails: emails.map((email) => ({ email })) } : {}),
      };
    }),
  };
}

/**
 * O envelope de uma REAÇÃO. PURO.
 *
 * ⚠️ `message_id` é o `providerMessageId` — o id ESTÁVEL —, e não o
 * `external_id`. Aquele é o id do EVENTO e muda a cada callback do mesmo envio:
 * apontar para ele colaria a reação em nada.
 *
 * ⚠️ EMOJI VAZIO NÃO É ENTRADA INVÁLIDA: é o comando de REMOVER a reação, e é
 * assim que a Meta desfaz. Recusar aqui deixaria o vendedor sem como tirar uma
 * reação que ele mesmo pôs.
 */
export function toNotificameReactionContent(
  r: { providerMessageId: string; emoji: string },
  kind: NotificameChannelKind,
): NotificameContent {
  const id = (r.providerMessageId ?? "").trim();
  if (!id) {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "reação sem o id da mensagem");
  }
  if (kind !== "whatsapp" && kind !== "instagram") {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, `reação — canal ${kind}`);
  }

  return { type: "reaction", reaction: { message_id: id, emoji: r.emoji ?? "" } };
}

/**
 * O envelope do balão de "digitando". PURO — e não leva nada além do tipo.
 *
 * Some sozinho do lado da Meta depois de alguns segundos; não há envelope de
 * "parou de digitar", e inventar um seria adivinhar.
 *
 * ⚠️ O exemplo da doc traz um `messageId` no corpo do digitando, comentado como
 * "id da mensagem que você ira responder" — texto claramente copiado da seção de
 * resposta citada logo acima. Um balão de digitando não responde a nada, e
 * mandar o campo seria propagar o erro de copiar-e-colar do fornecedor para
 * dentro do nosso envelope.
 */
export function toNotificameTypingContent(kind: NotificameChannelKind): NotificameContent {
  if (kind !== "whatsapp") {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, `digitando — canal ${kind}`);
  }
  return { type: "typing" };
}

/**
 * Acrescenta a CITAÇÃO ao envelope. PURO.
 *
 * ⚠️ `messageId` e `reply` vão na RAIZ do corpo, ao lado de `from` e `to` — e
 * NÃO dentro de `contents`, que é onde todo o resto mora. Aninhar produz uma
 * mensagem comum: o fornecedor aceita calado e a citação some sem erro nenhum,
 * que é o pior desfecho possível — parece que funcionou.
 *
 * Sem id, o envelope sai INTACTO: `reply: true` sozinho é um corpo que a Meta
 * recusa, e uma mensagem sem citação ainda é uma mensagem.
 *
 * ─── DIVERGÊNCIA CONSCIENTE DA DOC ──────────────────────────────────────────
 *
 * O exemplo da doc para resposta citada traz `"to": "whatsapp"` — a palavra, não
 * o número. Ele é o ÚNICO envelope de mensagem do documento inteiro com essa
 * forma, ao lado do endpoint de download de arquivo criptografado, que é de onde
 * ela provavelmente foi copiada. Todos os outros — texto, mídia, reação,
 * digitando, contato, interativa — mandam o destinatário.
 *
 * Mandamos o NÚMERO, e não a palavra. `normalizeNotificameRecipient` derruba
 * qualquer não-dígito antes do envio: `"whatsapp"` viraria string vazia e o
 * envio morreria com `invalid_recipient` sem sequer sair. Seguir a doc aqui
 * seria garantir a falha; divergir dela é a única forma de a mensagem existir.
 */
export function montarEnvelopeDeResposta(
  envelope: NotificameEnvelope,
  providerMessageId: string | null | undefined,
): NotificameEnvelope {
  const id = (providerMessageId ?? "").trim();
  if (!id) return envelope;

  return { ...envelope, messageId: id, reply: true } as NotificameEnvelope;
}

/** As três ações de bloqueio, na forma nossa. */
export type AcaoDeBloqueio = "bloquear" | "desbloquear" | "listar";

const TIPO_POR_ACAO: Record<AcaoDeBloqueio, string> = {
  bloquear: "block_user",
  desbloquear: "unblock_user",
  listar: "list_blocked",
};

/**
 * O envelope de bloqueio. PURO.
 *
 * As três viajam pela MESMA rota das mensagens, com um `contents` de um item só
 * e sem carga nenhuma. O destinatário vai no `to` do envelope, como em qualquer
 * mensagem — inclusive no `list_blocked`, onde ele não significa nada e a doc o
 * manda assim mesmo.
 *
 * ⚠️ NENHUMA delas é mensagem. Quem chama tem de gravar NADA na conversa: um
 * "bloqueado" no meio da thread seria uma bolha que o cliente nunca recebeu.
 */
export function toNotificameBlockContent(
  acao: AcaoDeBloqueio,
  kind: NotificameChannelKind,
): NotificameContent {
  if (kind !== "whatsapp") {
    throw new NotSupportedError(
      NOTIFICAME_PROVIDER,
      `bloqueio de contato — o canal ${kind} não o traz na doc`,
    );
  }
  return { type: TIPO_POR_ACAO[acao] };
}

/** O convite de opt-in, na forma nossa. */
export interface ConviteDeOptIn {
  /** O que a pessoa lê na tela de aceite. 1 a 300 caracteres. */
  mensagem: string;
  /** O que ela recebe logo após aceitar. 1 a 300 caracteres. */
  confirmacao: string;
  /** Apelido interno do convite. NÃO é exibido a ninguém. 1 a 256. */
  nome: string;
  /** Imutável depois da criação, segundo a doc. */
  politicaDePrivacidade: string;
  site: string;
  /** Substitui `{{promo_code}}` na confirmação. Alfanumérico, até 50. */
  codigoPromocional?: string;
}

/**
 * O envelope de CRIAÇÃO de um convite de opt-in.
 *
 * ⚠️ ARMADILHA DO FORNECEDOR: criar e listar usam o MESMO `type: "list"`. O que
 * distingue os dois é a presença de `signup_content` — um corpo de criação sem
 * ele vira, em silêncio, uma listagem, e o operador fica achando que criou.
 */
export function toNotificameSignupContent(c: ConviteDeOptIn): NotificameContent {
  return {
    type: "list",
    signup_content: {
      signup_message: c.mensagem.trim(),
      confirmation_message: c.confirmacao.trim(),
      display_name: c.nome.trim(),
      privacy_policy_url: c.politicaDePrivacidade.trim(),
      website_url: c.site.trim(),
      ...(c.codigoPromocional?.trim() ? { promo_code: c.codigoPromocional.trim() } : {}),
    },
  };
}

/** O envelope de LISTAGEM. Ver a armadilha em `toNotificameSignupContent`. */
export function toNotificameSignupListContent(limite: number): NotificameContent {
  return { type: "list", limit: limite };
}

/**
 * O deep link que se manda ao cliente. Formato da Meta:
 * `wa.me/<numero>/signup/<id>`, com o número em formato internacional e SEM
 * símbolo nenhum — `+`, espaço ou traço quebram o link.
 */
export function linkDeOptIn(numeroDaEmpresa: string, signupId: string): string {
  const digitos = String(numeroDaEmpresa ?? "").replace(/\D/g, "");
  return `https://wa.me/${digitos}/signup/${String(signupId ?? "").trim()}`;
}

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
      // ⚠️ Isto já foi um `NotSupportedError` justificado por "o canal oficial
      // não tem figurinha, e mapeá-la seria adivinhar". A afirmação era FALSA: a
      // doc corrente do fornecedor tem uma seção "Enviar um sticker", e o
      // envelope é este, com nome próprio. Não havia o que adivinhar.
      //
      // Fica fora do Instagram porque LÁ a doc não o traz — a diferença entre as
      // duas frases é que esta foi conferida.
      if (kind !== "whatsapp") {
        throw new NotSupportedError(
          NOTIFICAME_PROVIDER,
          `sendMedia(sticker) — o canal ${kind} não aceita figurinha`,
        );
      }
      return {
        type: "file",
        fileMimeType: "sticker",
        fileUrl: file,
        // O contrato pede legenda; o WhatsApp não a exibe em figurinha. É o
        // valor que a própria doc usa no exemplo.
        fileCaption: "Sticker",
      };
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
  /**
   * Uma chamada que PERGUNTA em vez de mandar — devolve o corpo parseado.
   *
   * `send()` devolve só o id da mensagem, porque é isso que um envio produz.
   * Listar bloqueados e consultar a saúde do número não produzem mensagem
   * nenhuma: a resposta É o resultado, e jogá-la fora deixaria a tela sem o que
   * mostrar.
   *
   * ⚠️ NÃO GRAVA NADA. Nenhuma destas ações é mensagem da conversa.
   */
  private async perguntar(
    caminho: string,
    corpo: Record<string, unknown>,
  ): Promise<unknown> {
    const cfg = await this.resolveOrgConfig();

    const r = await this.fetchImpl(`${cfg.baseUrl}${caminho}`, {
      method: "POST",
      headers: {
        "X-Api-Token": cfg.subaccountToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(corpo),
    });

    const texto = await r.text();
    if (!r.ok) {
      throw new NotificameError(
        "consulta_recusada",
        `O NotificaMe recusou a consulta (HTTP ${r.status})`,
      );
    }

    const parsed = parseNotificameBody(texto);
    return parsed.ok ? parsed.value : null;
  }

  private async send(params: {
    to: string;
    content: NotificameContent;
    messageType: string;
    text: string | null;
    mediaUrl: string | null;
    /** Só em template: os rótulos dos botões, para a conversa poder exibi-los. */
    botoes?: string[];
    /** O id ESTÁVEL da mensagem citada, quando esta responde a outra. */
    citandoProviderMessageId?: string | null;
    /**
     * `true` para o que NÃO é mensagem da conversa — hoje só o balão de
     * digitando. Sem isto, cada indicador viraria uma linha vazia na thread, e a
     * conversa ficaria uma escada de nada entre as mensagens de verdade.
     */
    naoGravar?: boolean;
  }): Promise<SendResult> {
    const to = normalizeNotificameRecipient(this.channelKind, params.to);
    if (!to) {
      throw new NotificameError(
        "invalid_recipient",
        "Destinatário vazio ou inválido para o canal do NotificaMe",
      );
    }

    const cfg = await this.resolveOrgConfig();
    // A citação entra na RAIZ do envelope — ver `montarEnvelopeDeResposta`. Ela
    // é a única exceção ao padrão do contrato, e aninhá-la em `contents` faria a
    // citação sumir sem erro nenhum.
    const envelope = montarEnvelopeDeResposta(
      buildNotificameEnvelope({
        from: this.channelId,
        to,
        content: params.content,
      }),
      params.citandoProviderMessageId,
    );

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

    if (params.naoGravar) {
      return { message_id: messageId, status: "sent", timestamp: this.now().getTime() };
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
      // `replyid` é o nome que o contrato já usa no eixo da Uazapi. Aqui o valor
      // tem de ser o `providerMessageId` — o id ESTÁVEL —, e não o `external_id`.
      citandoProviderMessageId: opts.replyid,
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

  // ── setPresence ───────────────────────────────────────────────────────────
  /**
   * O balão de "digitando…".
   *
   * ⚠️ Isto era um no-op justificado por "o canal oficial não tem digitando". A
   * afirmação era FALSA: a doc do fornecedor tem uma seção "Balão de digitando",
   * com envelope próprio (`{type:"typing"}`). É a terceira asserção negativa
   * errada encontrada neste arquivo — junto com figurinha e mensagem interativa.
   *
   * ⚠️ NÃO LANÇA, e isso continua valendo: o Copilot chama `setPresence` ANTES de
   * todo envio, e um throw aqui mataria a mensagem por causa de um indicador
   * cosmético. Falha de rede no balão não pode custar a conversa.
   *
   * `available` segue no-op: não existe envelope de "parou de digitar", e o
   * balão some sozinho do lado da Meta depois de alguns segundos. Inventar um
   * seria adivinhar.
   */
  async setPresence(number: string, state: "composing" | "available"): Promise<void> {
    if (state !== "composing") return;

    try {
      await this.send({
        to: number,
        content: toNotificameTypingContent(this.channelKind),
        messageType: "typing",
        // Indicador não é mensagem: não entra na conversa.
        naoGravar: true,
        // Sem texto e sem mídia: o balão não é uma mensagem da conversa, e
        // gravá-lo com conteúdo poria uma linha vazia na thread.
        text: null,
        mediaUrl: null,
      });
    } catch {
      // Engolido de propósito. Ver o ⚠️ acima.
    }
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

  async sendMenu(opts: SendMenuOptions): Promise<SendResult> {
    // Recusa alto e ANTES do I/O: quem decide é o envelope, e a mensagem dele
    // diz o que fazer. Enquete e carrossel morrem ali, com nome.
    const opcoes = opts.richChoices?.length
      ? opts.richChoices.map((c) => ({ titulo: c.title, descricao: c.description }))
      : opts.choices.map((c) => ({ titulo: c }));

    const content = toNotificameInteractiveContent(
      {
        tipo: opts.type,
        texto: opts.text,
        rodape: opts.footer,
        opcoes,
        rotuloDaLista: opts.listButtonLabel,
        ctaUrl: opts.ctaUrl,
      },
      this.channelKind,
    );

    return await this.send({
      to: opts.number,
      content,
      messageType: opts.type === "list" ? "list" : "interactive",
      // O corpo é o que a conversa mostra; as opções vão para o metadata, pelo
      // mesmo motivo dos botões de template — a Meta desenha a faixa do lado
      // dela, e deste lado não há como saber o que o cliente está vendo.
      text: opts.text.trim() || null,
      mediaUrl: null,
      botoes: opcoes.map((o) => o.titulo.trim()).filter(Boolean),
    });
  }

  async sendLocation(opts: {
    number: string;
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  }): Promise<SendResult> {
    const content = toNotificameLocationContent(
      {
        latitude: opts.latitude,
        longitude: opts.longitude,
        nome: opts.name,
        endereco: opts.address,
      },
      this.channelKind,
    );

    return await this.send({
      to: opts.number,
      content,
      messageType: "location",
      // O nome do lugar é o que a LISTA DE CONVERSAS mostra: sem ele a conversa
      // aparece em branco na lateral depois de uma localização.
      text: opts.name?.trim() || opts.address?.trim() || null,
      mediaUrl: null,
    });
  }

  async sendContact(opts: {
    number: string;
    contacts: Array<{
      nome: string;
      telefones: Array<{ numero: string; waId?: string }>;
      emails?: string[];
    }>;
  }): Promise<SendResult> {
    const content = toNotificameContactContent(opts.contacts, this.channelKind);

    return await this.send({
      to: opts.number,
      content,
      messageType: "contacts",
      text: opts.contacts.map((c) => c.nome.trim()).filter(Boolean).join(", ") || null,
      mediaUrl: null,
    });
  }

  sendPixButton(): Promise<SendResult> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "sendPixButton");
  }

  /**
   * ⚠️ `messageId` AQUI É O `providerMessageId`, o id ESTÁVEL — e não o
   * `external_id`, que é o id do evento e muda a cada callback do mesmo envio.
   * Quem chama é responsável por mandar o certo; apontar para o id do evento
   * cola a reação em nada, e o fornecedor aceita calado.
   */
  async react(messageId: string, number: string, emoji: string): Promise<void> {
    const content = toNotificameReactionContent(
      { providerMessageId: messageId, emoji },
      this.channelKind,
    );

    await this.send({
      to: number,
      content,
      messageType: "reaction",
      // O emoji é o texto da linha — é o que a conversa mostra. Vazio significa
      // REMOVER a reação, e aí não há o que exibir.
      text: emoji?.trim() || null,
      mediaUrl: null,
    });
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

  /**
   * ⚠️ `markRead` CONTINUA FORA, e a ausência foi procurada antes de afirmada:
   * não há seção no índice da doc do fornecedor nem ocorrência no corpo da parte
   * de WhatsApp. Ele não expõe a confirmação de leitura.
   */
  markRead(): Promise<void> {
    throw new NotSupportedError(NOTIFICAME_PROVIDER, "markRead");
  }

  /**
   * Bloqueia o contato. O cliente deixa de conseguir escrever para este número.
   *
   * ⚠️ NÃO GRAVA LINHA. Bloquear não é mensagem, e uma bolha "bloqueado" no meio
   * da thread seria algo que o cliente nunca recebeu.
   */
  async blockUser(number: string): Promise<void> {
    await this.send({
      to: number,
      content: toNotificameBlockContent("bloquear", this.channelKind),
      messageType: "block_user",
      text: null,
      mediaUrl: null,
      naoGravar: true,
    });
  }

  async unblockUser(number: string): Promise<void> {
    await this.send({
      to: number,
      content: toNotificameBlockContent("desbloquear", this.channelKind),
      messageType: "unblock_user",
      text: null,
      mediaUrl: null,
      naoGravar: true,
    });
  }

  /**
   * Quem está bloqueado. A resposta É o resultado — por isso não passa pelo
   * `send`, que devolveria só um id de mensagem.
   */
  async listBlocked(): Promise<unknown> {
    return await this.perguntar(notificameSendPath(this.channelKind), {
      from: this.channelId,
      // O `to` não significa nada aqui, e a doc o manda assim mesmo. Vai o
      // próprio canal para não inventar um destinatário.
      to: this.channelId,
      contents: [toNotificameBlockContent("listar", this.channelKind)],
    });
  }

  /**
   * A saúde do número, do lado da Meta — verde, amarelo ou vermelho.
   *
   * É determinada pelo feedback dos clientes: bloqueios e denúncias derrubam a
   * nota, e nota vermelha é o degrau antes de o número ser limitado. Rota
   * PRÓPRIA, fora do caminho de mensagens.
   */
  /**
   * Cria um convite de opt-in e devolve o corpo do fornecedor — de onde sai o
   * `id` que vira o deep link.
   *
   * O `from` é o `channelId`: a doc o chama de "token do canal", que é o mesmo
   * valor que a criação de template já manda e que funciona em produção.
   */
  async createSignupInvite(convite: ConviteDeOptIn): Promise<unknown> {
    return await this.perguntar("/v2/channels/whatsapp/app", {
      from: this.channelId,
      contents: [toNotificameSignupContent(convite)],
    });
  }

  async listSignupInvites(limite = 20): Promise<unknown> {
    return await this.perguntar("/v2/channels/whatsapp/app", {
      from: this.channelId,
      contents: [toNotificameSignupListContent(limite)],
    });
  }

  async numberHealth(): Promise<unknown> {
    return await this.perguntar("/v2/meta/health_status", { from: this.channelId });
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
