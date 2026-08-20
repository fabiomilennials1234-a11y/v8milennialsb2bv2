/**
 * notificame-content — o que a conversa MOSTRA a partir do corpo de entrada.
 *
 * ─── POR QUE UM MÓDULO NOVO, E NÃO UMA EDIÇÃO EM `notificame-inbound` ───────
 *
 * `pickContent` decide texto, mídia e tipo para as 2 caixas de Instagram vivas e
 * para a Chique. Alterá-lo é mexer no que já funciona; este módulo o CHAMA e
 * ACRESCENTA, de modo que o texto continua saindo exatamente da mesma função e
 * os testes dela seguem valendo.
 *
 * O que este módulo adiciona é `metadata`: a forma NOSSA do que o fornecedor
 * mandou. A tela lê esta forma e nunca o corpo dele — quando o formato dele
 * mudar, muda um parser puro com fixture real, e nenhuma tela quebra.
 */

import { pickContent, type InboundContent } from "./notificame-inbound.ts";

/** O que a bolha precisa saber, na forma nossa. */
/** Espécie do arquivo, derivada do ENVELOPE — nunca do mime declarado. */
export type EspecieDeMidia =
  | "audio"
  | "imagem"
  | "video"
  | "documento"
  | "sticker"
  /** É arquivo, mas o envelope não diz o quê — a espécie sai do content-type real. */
  | "indefinida";

export interface InboundMetadata {
  tipo:
    | "texto"
    | "midia"
    | "resposta"
    | "link"
    | "reacao"
    | "localizacao"
    | "contato";
  /** Cartões de contato. O envelope permite mais de um por mensagem. */
  contatos?: Array<{
    nome: string | null;
    telefones: Array<{ numero: string; waId: string | null }>;
    emails: string[];
  }>;
  /** Ponto no mapa. `nome`/`endereco` são opcionais no envelope. */
  localizacao?: {
    latitude: number;
    longitude: number;
    nome: string | null;
    endereco: string | null;
  };
  /** Emoji colado numa mensagem que já existe — não é uma mensagem nova. */
  reacao?: { emoji: string; alvoProviderMessageId: string | null };
  /** Publicação compartilhada: uma PÁGINA, que não se baixa nem se espelha. */
  link?: { url: string; especie: string };
  /** Arquivo, quando o corpo traz um. */
  midia?: {
    url: string;
    especie: EspecieDeMidia;
    /** `null` quando o fornecedor declarou algo incompatível com a espécie. */
    mime: string | null;
    nome: string | null;
    /**
     * `true` quando o arquivo passou a ser servido de casa. `false`/ausente
     * significa que a URL ainda é a do fornecedor — assinada e temporária, e a
     * bolha vai quebrar quando ela vencer.
     */
    espelhada?: boolean;
  };
  /** Clique de botão ou escolha de lista: o que o cliente escolheu. */
  resposta?: { titulo: string; payload: string | null };
  /** A mensagem a que esta responde. `de` é quem mandou a CITADA. */
  citacao?: { providerMessageId: string; de: string | null };
}

export interface ConteudoNormalizado extends InboundContent {
  metadata: InboundMetadata;
}

/** O primeiro item de `contents`, venha ele do topo ou aninhado em `message`. */
function primeiroConteudo(payload: unknown): Record<string, unknown> | null {
  const p = payload as { contents?: unknown; message?: { contents?: unknown } } | null;
  const lista = Array.isArray(p?.message?.contents)
    ? p!.message!.contents
    : Array.isArray(p?.contents)
    ? p!.contents
    : null;
  const primeiro = lista?.[0];
  return primeiro && typeof primeiro === "object" ? primeiro as Record<string, unknown> : null;
}

/**
 * Número, aceitando string numérica.
 *
 * ⚠️ `0` É VALOR. Um `!numero` aqui apagaria a longitude de Greenwich e a
 * latitude do equador — e o golfo da Guiné, onde as duas se cruzam, é onde todo
 * bug de coordenada vai parar.
 */
function numeroDe(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function textoDe(valor: unknown): string | null {
  const s = typeof valor === "string" ? valor.trim() : "";
  return s === "" ? null : s;
}

/**
 * A mensagem citada, quando o corpo a traz.
 *
 * O fornecedor põe `context` FORA de `contents`, ao lado do texto — mesmo lugar
 * em que a Meta põe. O id aqui é o `providerMessageId` da citada, que é a chave
 * estável: `message.id` muda a cada callback do mesmo envio.
 */
function lerCitacao(payload: unknown): InboundMetadata["citacao"] {
  const ctx = (payload as { message?: { context?: unknown }; context?: unknown } | null);
  const bruto = (ctx?.message as { context?: unknown } | undefined)?.context ?? ctx?.context;
  if (!bruto || typeof bruto !== "object") return undefined;

  const { id, from } = bruto as { id?: unknown; from?: unknown };
  const providerMessageId = textoDe(id);
  if (!providerMessageId) return undefined;

  return { providerMessageId, de: textoDe(from) };
}

/**
 * A espécie do arquivo sai do `type` do envelope, que o fornecedor acerta.
 *
 * Devolve `null` para o que não é arquivo — texto, botão, reação.
 */
const ESPECIE_POR_TIPO: Record<string, EspecieDeMidia> = {
  audio: "audio",
  ptt: "audio",
  voice: "audio",
  image: "imagem",
  photo: "imagem",
  video: "video",
  file: "documento",
  document: "documento",
  sticker: "sticker",
};

/** A família de mime que cada espécie aceita. */
const FAMILIA_POR_ESPECIE: Record<EspecieDeMidia, string | null> = {
  audio: "audio/",
  imagem: "image/",
  video: "video/",
  sticker: "image/",
  documento: null, // documento é qualquer coisa; nada a conferir
  indefinida: null,
};

/**
 * O mime declarado, SE ele for plausível para a espécie.
 *
 * ⚠️ O fornecedor declara `"text/html"` para áudio, imagem, reel e story — os
 * quatro corpos reais medidos, sem exceção. Gravar isso como content-type faz o
 * navegador tentar renderizar o áudio do cliente como página. O mime de verdade
 * vem do `content-type` da resposta HTTP, no espelhamento; aqui, na dúvida,
 * `null` é a resposta honesta.
 */
function mimePlausivel(declarado: unknown, especie: EspecieDeMidia): string | null {
  const m = textoDe(declarado)?.toLowerCase() ?? null;
  if (!m) return null;
  const familia = FAMILIA_POR_ESPECIE[especie];
  if (familia === null) return m;
  return m.startsWith(familia) ? m : null;
}

/**
 * Hosts que servem PÁGINA, não arquivo.
 *
 * A lista é de páginas e não de CDNs de propósito: o desconhecido cai em
 * ARQUIVO, que é o caso comum e o que o espelhamento sabe tratar. Uma lista de
 * CDNs faria todo host novo do fornecedor virar link, e a mídia sumiria da
 * conversa sem ninguém entender por quê.
 */
const HOSTS_DE_PAGINA = ["instagram.com", "facebook.com", "fb.watch", "wa.me", "youtube.com", "youtu.be"];

function ehPagina(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return HOSTS_DE_PAGINA.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function normalizarConteudo(payload: unknown): ConteudoNormalizado {
  const base = pickContent(payload);
  const c = primeiroConteudo(payload);
  const citacao = lerCitacao(payload);

  // Clique de botão. O TÍTULO é a resposta: é a palavra que o cliente vê e
  // acredita ter enviado. O `payload` é o identificador que a automação casa —
  // guardado à parte porque pode ser um código que não significa nada para quem
  // lê a conversa.
  // ⚠️ POR CHAVE PRESENTE, NUNCA PELO `type`. O clique de botão do Instagram
  // chega com `type: "text"` e um objeto `postback` — o tipo declarado mente, e
  // ler por ele deixaria a linha vazia, que é como 2 cliques reais em "Liberar
  // catálogo" entraram no banco sem nada para mostrar.
  // A escolha de lista e o clique de botão chegam dentro de `interactive`, no
  // formato da Meta. Ambos são "o cliente tocou numa opção que oferecemos" —
  // mesma natureza, mesmo tipo, e por isso a leitura converge para cá.
  const interativa = c?.interactive as
    | { list_reply?: unknown; button_reply?: unknown }
    | undefined;
  const escolha = (interativa?.list_reply ?? interativa?.button_reply) as
    | { id?: unknown; title?: unknown }
    | undefined;

  const botao = (c?.button ?? c?.postback ?? escolha) as
    | {
      text?: unknown;
      title?: unknown;
      payload?: unknown;
      id?: unknown;
      providerMessageId?: unknown;
    }
    | undefined;
  if (botao) {
    const titulo = textoDe(botao.text) ?? textoDe(botao.title);
    if (titulo) {
      // O postback carrega o alvo dentro de si; o botão do WhatsApp usa
      // `context`, fora de `contents`. Os dois querem dizer a mesma coisa: a
      // mensagem que levava o botão.
      const alvo = textoDe(botao.providerMessageId);
      const daResposta = alvo ? { providerMessageId: alvo, de: null } : undefined;
      const citacaoFinal = citacao ?? daResposta;

      return {
        ...base,
        content: titulo,
        metadata: {
          tipo: "resposta",
          // `payload` no botão do WhatsApp e no postback; `id` na lista. É o
          // identificador que a automação casa — separado do título porque pode
          // ser um código sem sentido para quem lê a conversa.
          resposta: { titulo, payload: textoDe(botao.payload) ?? textoDe(botao.id) },
          ...(citacaoFinal ? { citacao: citacaoFinal } : {}),
        },
      };
    }
  }

  // Arquivo. A URL mora em `fileUrl` — e é ESTE o campo que faltava: o parser
  // procurava `url`, que o fornecedor nunca manda, e por isso 100% da mídia
  // recebida nas caixas de Instagram entrou com `media_url` nulo.
  // Reação. NÃO é uma mensagem: é um emoji colado numa mensagem que já está na
  // thread. O alvo vem por `providerMessageId` — o id ESTÁVEL, e a razão de a
  // coluna `provider_message_id` existir.
  const reacao = c?.reaction as
    | { emoji?: unknown; reaction_to?: { providerMessageId?: unknown } }
    | undefined;
  if (reacao) {
    const emoji = textoDe(reacao.emoji);
    if (emoji) {
      return {
        ...base,
        content: emoji,
        metadata: {
          tipo: "reacao",
          reacao: {
            emoji,
            alvoProviderMessageId: textoDe(reacao.reaction_to?.providerMessageId),
          },
          ...(citacao ? { citacao } : {}),
        },
      };
    }
  }

  // Contato. O envelope traz uma LISTA — o WhatsApp permite anexar vários
  // cartões numa mensagem só, e mostrar apenas o primeiro esconderia contatos
  // que o cliente mandou.
  const contatosCrus = c?.contacts;
  if (Array.isArray(contatosCrus) && contatosCrus.length > 0) {
    const contatos = contatosCrus.map((bruto) => {
      const x = (bruto ?? {}) as Record<string, unknown>;
      const nome = x.name as Record<string, unknown> | undefined;
      const telefones = Array.isArray(x.phones) ? x.phones : [];
      const emails = Array.isArray(x.emails) ? x.emails : [];
      return {
        nome: textoDe(nome?.formatted_name) ??
          textoDe([nome?.first_name, nome?.last_name].filter(Boolean).join(" ")),
        telefones: telefones
          .map((t) => {
            const y = (t ?? {}) as Record<string, unknown>;
            const numero = textoDe(y.phone) ?? textoDe(y.wa_id);
            return numero ? { numero, waId: textoDe(y.wa_id) } : null;
          })
          .filter((t): t is { numero: string; waId: string | null } => t !== null),
        emails: emails
          .map((e) => textoDe((e as Record<string, unknown>)?.email))
          .filter((e): e is string => e !== null),
      };
    });

    // O nome vai para `content` porque é ele que a LISTA DE CONVERSAS mostra:
    // sem isso a conversa aparece em branco na lateral depois de um contato.
    const rotulo = contatos.map((x) => x.nome).filter(Boolean).join(", ");

    return {
      ...base,
      content: textoDe(rotulo),
      metadata: {
        tipo: "contato",
        contatos,
        ...(citacao ? { citacao } : {}),
      },
    };
  }

  // Localização. Os campos ficam NO NÍVEL do content, e não aninhados sob
  // `location` — é o que a doc do fornecedor mostra, e diverge do formato da
  // Graph, que aninha.
  const lat = numeroDe(c?.latitude ?? (c?.location as Record<string, unknown>)?.latitude);
  const lng = numeroDe(c?.longitude ?? (c?.location as Record<string, unknown>)?.longitude);
  if (lat !== null && lng !== null) {
    const loc = (c?.location ?? c) as Record<string, unknown>;
    return {
      ...base,
      metadata: {
        tipo: "localizacao",
        localizacao: {
          latitude: lat,
          longitude: lng,
          nome: textoDe(loc.name),
          endereco: textoDe(loc.address),
        },
        ...(citacao ? { citacao } : {}),
      },
    };
  }

  const tipoDeclarado = textoDe(c?.type)?.toLowerCase() ?? "";
  const fileUrl = textoDe(c?.fileUrl) ?? base.mediaUrl;
  if (fileUrl) {
    // Publicação compartilhada — reel, post aberto no app. `fileUrl` aponta para
    // a PÁGINA. Baixar isso guardaria HTML servido como se fosse vídeo, e a
    // bolha, sem extensão na URL, ofereceria "baixar documento" para um post.
    if (ehPagina(fileUrl)) {
      return {
        ...base,
        mediaUrl: null,
        metadata: {
          tipo: "link",
          link: { url: fileUrl, especie: tipoDeclarado.replace(/^ig_/, "") },
          ...(citacao ? { citacao } : {}),
        },
      };
    }

    const especie = ESPECIE_POR_TIPO[tipoDeclarado] ?? "indefinida";
    return {
      ...base,
      mediaUrl: fileUrl,
      metadata: {
        tipo: "midia",
        midia: {
          url: fileUrl,
          especie,
          mime: mimePlausivel(c?.fileMimeType, especie),
          nome: textoDe(c?.fileName),
        },
        ...(citacao ? { citacao } : {}),
      },
    };
  }

  return {
    ...base,
    metadata: {
      tipo: base.mediaUrl ? "midia" : "texto",
      ...(citacao ? { citacao } : {}),
    },
  };
}
