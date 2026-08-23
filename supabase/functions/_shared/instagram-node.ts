/**
 * instagram-node — o que o nó de Instagram vai mandar. PURO.
 *
 * ─── POR QUE ESTA REGRA MORA FORA DO HANDLER ────────────────────────────────
 *
 * Porque as decisões que custam caro estão TODAS aqui: o que o Direct aceita, o
 * que ele não tem, e o que nunca deve virar uma URL que um terceiro vai buscar.
 * Enterradas no handler, só seriam exercitadas com banco e rede — e o handler é
 * justamente a parte que nenhum teste alcança sem os dois.
 *
 * ─── O ESCOPO, E POR QUE ELE É MENOR QUE O DO WHATSAPP ──────────────────────
 *
 * Texto, imagem, vídeo e áudio. DOCUMENTO E FIGURINHA FICAM DE FORA: o Direct
 * não os tem. O provider já recusa os dois com erro legível
 * (`toNotificameMediaContent`), mas deixar a recusa só lá faria o gestor montar
 * o nó, publicar o workflow, e descobrir no primeiro lead real — depois de a
 * execução parar. Recusar na leitura do nó é recusar antes de custar.
 *
 * ─── A URL DO ANEXO NÃO É NOSSA, E QUEM A BUSCA TAMBÉM NÃO ──────────────────
 *
 * Quem baixa o arquivo é o FORNECEDOR. Uma URL interna aqui vira sonda contra a
 * rede de quem buscar, com a reputação deles. Por isso a validação não é
 * reimplementada: ela é a MESMA de `notificame-social-send.ts`, que já serve o
 * envio pelo chat. Duas cópias divergiriam, e a que divergisse seria a frouxa.
 */

import {
  readSocialSendPayload,
  type SocialMediaPayload,
} from "./notificame-social-send.ts";

export type EnvioDoNoInstagram =
  | { ok: true; kind: "text"; text: string }
  | { ok: true; kind: "media"; media: SocialMediaPayload }
  | { ok: false; code: string; error: string };

/**
 * O que o Direct NÃO tem, e o nome pelo qual o gestor o conhece na tela.
 *
 * Recusar por NOME é o que separa "documento não dá" de "media_type_unsupported"
 * — a segunda frase manda o gestor abrir um chamado.
 */
const FORA_DO_DIRECT = new Map<string, string>([
  ["documento", "documento"],
  ["document", "documento"],
  ["arquivo", "documento"],
  ["file", "documento"],
  ["sticker", "figurinha"],
  ["figurinha", "figurinha"],
]);

/** Os três tipos de mídia que o Direct aceita, no vocabulário do provider. */
const MIDIA = new Map<string, SocialMediaPayload["type"]>([
  ["imagem", "image"],
  ["image", "image"],
  ["foto", "image"],
  ["video", "video"],
  ["vídeo", "video"],
  ["audio", "audio"],
  ["áudio", "audio"],
]);

const TEXTO = new Set(["", "texto", "text", "mensagem"]);

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Lê a configuração do nó e devolve o que enviar — ou a recusa, com motivo.
 *
 * `nodeData` chega como o objeto cru que o editor de workflow gravou. Nada aqui
 * toca banco nem rede.
 */
export function lerEnvioDoNoInstagram(
  nodeData: Record<string, unknown>,
): EnvioDoNoInstagram {
  // ⚠️ O NÓ É DO INSTAGRAM, E SÓ. O campo `metaChannel` sobrou da rota antiga da
  // Meta direta, que oferecia Messenger. A tela não o oferece mais; um valor
  // vindo de uma definição editada à mão é recusado em vez de silenciosamente
  // virar Instagram — mandar pela caixa errada é pior que não mandar.
  const canal = texto(nodeData.metaChannel).toLowerCase();
  if (canal && canal !== "instagram") {
    return {
      ok: false,
      code: "canal_nao_suportado",
      error: `Este nó envia apenas pelo Instagram Direct — "${canal}" não está disponível`,
    };
  }

  const tipoBruto = texto(nodeData.metaMessageType).toLowerCase();

  const proibido = FORA_DO_DIRECT.get(tipoBruto);
  if (proibido) {
    return {
      ok: false,
      code: "tipo_fora_do_direct",
      error:
        `O Instagram Direct não envia ${proibido}. Use texto, imagem, vídeo ou áudio`,
    };
  }

  if (!TEXTO.has(tipoBruto) && !MIDIA.has(tipoBruto)) {
    return {
      ok: false,
      code: "tipo_desconhecido",
      error: `Tipo de mensagem "${tipoBruto}" não existe no Instagram Direct`,
    };
  }

  const tipoDeMidia = MIDIA.get(tipoBruto);

  // A validação de URL e a leitura da legenda são as MESMAS do envio pelo chat.
  // Montamos o corpo que aquela função já sabe ler em vez de repetir as regras.
  const bruto = tipoDeMidia
    ? {
      media: {
        type: tipoDeMidia,
        url: texto(nodeData.metaMediaUrl) || texto(nodeData.mediaUrl),
        caption: texto(nodeData.metaCaption),
      },
      // Sem legenda própria, o texto do nó vira a legenda do anexo — mandar os
      // dois separados entregaria a mesma frase duas vezes ao cliente.
      text: texto(nodeData.metaMessage),
    }
    : { text: texto(nodeData.metaMessage) || texto(nodeData.message) };

  const lido = readSocialSendPayload(bruto);

  if (!lido.ok) {
    // Os códigos do gate do chat descrevem um CORPO de requisição; aqui a origem
    // é um campo da tela do workflow, e o gestor precisa saber qual campo abrir.
    if (lido.code === "empty_message") {
      return {
        ok: false,
        code: "mensagem_vazia",
        error: "Escreva a mensagem que o nó vai enviar no Direct",
      };
    }
    if (lido.code === "media_url_invalid") {
      return {
        ok: false,
        code: "midia_url_invalida",
        error: "O arquivo precisa estar publicado numa URL https acessível pela internet",
      };
    }
    return lido;
  }

  return lido;
}
