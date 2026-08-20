/**
 * menu-sender — quem envia uma mensagem interativa, por canal.
 *
 * ─── POR QUE UM OBJETO, E NUNCA UM HOOK POR PROP ────────────────────────────
 *
 * O construtor de menu é o mesmo nos dois eixos; o que muda é o que acontece
 * depois do envio. A tentação é passar o hook de envio por prop — e isso QUEBRA:
 * a ordem dos hooks muda entre renderizações quando o pai troca de canal, o
 * React aborta com "Rendered more hooks than during the previous render", e
 * nenhum gate de tipo ou de lint pega. Já aconteceu neste chat.
 *
 * O shell chama suas mutations INCONDICIONALMENTE e monta um destes objetos.
 *
 * ─── A DIFERENÇA REAL ENTRE OS DOIS ─────────────────────────────────────────
 *
 * No eixo da Uazapi, a linha da conversa é escrita PELO NAVEGADOR depois do
 * envio. No canal oficial, quem escreve é o provider, no servidor, dentro da
 * mesma chamada — e por isso o enviador oficial não grava nada: gravar de novo
 * duplicaria a mensagem na tela.
 */

export type TipoDeMenu = "button" | "list" | "cta";

export interface OpcaoDeMenu {
  title: string;
  description?: string;
}

export interface MenuMontado {
  tipo: TipoDeMenu;
  texto: string;
  opcoes: OpcaoDeMenu[];
  /** Só em `list`: o texto do botão que ABRE a lista. */
  rotuloDaLista?: string;
  /** Só em `cta`: o endereço que o botão abre. */
  ctaUrl?: string;
  rodape?: string;
}

export interface EnviadorDeMenu {
  /** Os tipos que ESTE canal aceita. O construtor só mostra estes. */
  tipos: TipoDeMenu[];
  enviar(menu: MenuMontado): Promise<void>;
}

type AoEnviar = (
  instanceId: string,
  numero: string,
  tipo: TipoDeMenu,
  texto: string,
  opcoes: OpcaoDeMenu[],
  extras?: { listButtonLabel?: string; ctaUrl?: string; footer?: string },
) => Promise<unknown>;

interface Base {
  instanceId: string;
  numero: string;
  aoEnviar: AoEnviar;
  /** Chamado depois do envio — normalmente para invalidar a thread. */
  depois?: () => void;
}

/**
 * Canal oficial (Meta).
 *
 * Não grava a linha: o provider já a escreveu no servidor, na mesma chamada.
 * Escrever de novo aqui duplicaria a mensagem na conversa.
 */
export function criarEnviadorOficial(base: Base): EnviadorDeMenu {
  return {
    tipos: ["button", "list", "cta"],
    async enviar(menu) {
      await base.aoEnviar(base.instanceId, base.numero, menu.tipo, menu.texto, menu.opcoes, {
        listButtonLabel: menu.rotuloDaLista,
        ctaUrl: menu.ctaUrl,
        footer: menu.rodape,
      });
      base.depois?.();
    },
  };
}

/**
 * Uazapi.
 *
 * `cta` fica de fora: aquele provedor não tem botão de link, e mapeá-lo para
 * `button` entregaria ao cliente um botão que devolve texto no lugar de um que
 * abre o navegador.
 */
export function criarEnviadorUazapi(
  base: Base & { aoGravar?: (menu: MenuMontado, messageId: string | null) => Promise<void> },
): EnviadorDeMenu {
  return {
    tipos: ["button", "list"],
    async enviar(menu) {
      const r = (await base.aoEnviar(
        base.instanceId,
        base.numero,
        menu.tipo,
        menu.texto,
        menu.opcoes,
        { footer: menu.rodape },
      )) as { message_id?: string } | undefined;

      await base.aoGravar?.(menu, r?.message_id ?? null);
      base.depois?.();
    },
  };
}
