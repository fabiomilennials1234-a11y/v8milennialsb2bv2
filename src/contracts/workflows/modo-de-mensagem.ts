/**
 * O MODO DO NÓ DE MENSAGEM — a derivação, num lugar só.
 *
 * O painel oferece quatro modos e grava DOIS campos para descrever um: a chave
 * viva `templateMode` e a legada `useTemplate`. Derivar um modo a partir desse
 * par apareceu em três lugares — o painel, o validador do editor e o executor —
 * e as três cópias precisam concordar, porque a divergência é invisível: um nó
 * apareceria em modo template na tela e sairia como texto no envio.
 *
 * Este arquivo é a cópia do FRONT. A do executor é `modoDoNo`, em
 * `supabase/functions/_shared/decisao-de-envio.ts`, e não pode importar daqui —
 * Deno não resolve o alias `@/`. As duas ficam presas por
 * `tests/unit/modo-de-mensagem-twin.test.ts`, que roda as duas com as mesmas
 * entradas e exige o mesmo veredito.
 */

export type ModoDeMensagem = "free" | "campaign_template" | "meta_template" | "ai";

/**
 * O modo declarado no nó.
 *
 * `templateMode` manda quando existe. Sem ele, `useTemplate: true` significa o
 * modo Template Meta — é como o painel sempre leu nós antigos, e o executor
 * espelha essa leitura.
 */
export function modoDeMensagemDoNo(
  config: Record<string, unknown> | null | undefined,
): ModoDeMensagem {
  const declarado = config?.templateMode;
  if (typeof declarado === "string") return declarado as ModoDeMensagem;
  return config?.useTemplate === true ? "meta_template" : "free";
}

/** O nó manda template aprovado da Meta (e não texto livre)? */
export function ehModoTemplateMeta(
  config: Record<string, unknown> | null | undefined,
): boolean {
  return modoDeMensagemDoNo(config) === "meta_template";
}
