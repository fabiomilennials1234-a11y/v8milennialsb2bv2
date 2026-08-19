/**
 * inbound-metadata — o que a bolha desenha, decidido fora dela.
 *
 * ─── POR QUE ESTA CAMADA EXISTE ─────────────────────────────────────────────
 *
 * A bolha decide hoje comparando `message_type` com strings de fornecedor, e a
 * lista cresce a cada integração: `buttonResponseMessage`, `listResponse`,
 * `ContactsArrayMessage`, `PinInChatMessage`, `LocationMessage`. Cada provedor
 * novo é um apelido novo em `MessagePrimitives`, e um apelido esquecido é uma
 * mensagem que o cliente mandou aparecendo como "[Mensagem não suportada]".
 *
 * `metadata` é forma NOSSA: quem normaliza é o webhook, contra corpos reais e
 * com teste. Aqui só se traduz para o que a tela precisa saber.
 *
 * ⚠️ `metadata` NULO É O CAMINHO NORMAL, não erro: toda linha anterior a esta
 * fatia tem a coluna vazia, e o chat da Uazapi lê outra tabela, que nem tem a
 * coluna. Por isso o retorno cai no comportamento antigo em vez de reclamar.
 */

export type EspecieDeMidia =
  | "audio"
  | "imagem"
  | "video"
  | "documento"
  | "sticker"
  | "indefinida";

/** Um cartão de contato, na forma que a bolha desenha. */
export interface ContatoLido {
  nome: string | null;
  telefones: Array<{ numero: string; waId: string | null }>;
  emails: string[];
}

export type Bolha =
  | { tipo: "texto"; texto: string }
  | { tipo: "resposta"; titulo: string }
  | { tipo: "midia"; url: string; especie: EspecieDeMidia; nome: string | null }
  | { tipo: "link"; url: string; especie: string }
  | {
    tipo: "localizacao";
    latitude: number;
    longitude: number;
    nome: string | null;
    endereco: string | null;
  }
  | { tipo: "contato"; contatos: ContatoLido[] }
  | { tipo: "reacao"; emoji: string; alvo: string | null }
  | { tipo: "indisponivel" };

/**
 * Os tipos que a bolha normalizada assume.
 *
 * Fora daqui o caminho antigo segue mandando: áudio, imagem, vídeo e documento
 * já funcionam nos ramos de sempre — o que faltava neles era a URL, não o
 * desenho.
 */
export const TIPOS_NORMALIZADOS = new Set<Bolha["tipo"]>([
  "resposta",
  "link",
  "localizacao",
  "contato",
]);

/** A linha, no mínimo que esta decisão precisa. */
export interface MensagemLida {
  content: string | null;
  media_url: string | null;
  message_type: string | null;
  metadata: unknown;
}

export function lerBolha(m: MensagemLida): Bolha {
  const meta = (m.metadata ?? null) as Record<string, unknown> | null;

  if (meta && typeof meta === "object") {
    const tipo = meta.tipo;

    if (tipo === "resposta") {
      const r = meta.resposta as { titulo?: string } | undefined;
      if (r?.titulo) return { tipo: "resposta", titulo: r.titulo };
    }

    if (tipo === "midia") {
      const x = meta.midia as
        | { url?: string; especie?: EspecieDeMidia; nome?: string | null }
        | undefined;
      if (x?.url) {
        return {
          tipo: "midia",
          url: x.url,
          especie: x.especie ?? "indefinida",
          nome: x.nome ?? null,
        };
      }
    }

    if (tipo === "link") {
      const x = meta.link as { url?: string; especie?: string } | undefined;
      if (x?.url) return { tipo: "link", url: x.url, especie: x.especie ?? "" };
    }

    if (tipo === "localizacao") {
      const x = meta.localizacao as
        | { latitude?: number; longitude?: number; nome?: string | null; endereco?: string | null }
        | undefined;
      // `0` é coordenada válida: a comparação é com `undefined`, não um `!x`.
      if (x && x.latitude !== undefined && x.longitude !== undefined) {
        return {
          tipo: "localizacao",
          latitude: x.latitude,
          longitude: x.longitude,
          nome: x.nome ?? null,
          endereco: x.endereco ?? null,
        };
      }
    }

    if (tipo === "contato") {
      const x = meta.contatos as ContatoLido[] | undefined;
      if (Array.isArray(x) && x.length > 0) return { tipo: "contato", contatos: x };
    }

    if (tipo === "reacao") {
      const x = meta.reacao as { emoji?: string; alvoProviderMessageId?: string | null } | undefined;
      if (x?.emoji) {
        return { tipo: "reacao", emoji: x.emoji, alvo: x.alvoProviderMessageId ?? null };
      }
    }
  }

  // Caminho antigo. Vale para tudo que foi gravado antes desta fatia e para o
  // chat da Uazapi, que lê `whatsapp_messages` e não tem esta coluna.
  if (m.content) return { tipo: "texto", texto: m.content };
  return { tipo: "indisponivel" };
}
