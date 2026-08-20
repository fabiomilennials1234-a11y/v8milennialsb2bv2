/**
 * template-node-valores — o que preenche um template disparado por AUTOMAÇÃO.
 *
 * ─── O DESCOMPASSO QUE ISTO ATRAVESSA ───────────────────────────────────────
 *
 * A Meta numera as variáveis de um template por POSIÇÃO — `{{1}}`, `{{2}}` — e
 * o produto as nomeia — `{{nome}}`, `{{empresa}}`. No chat o vendedor digita o
 * valor na hora e o descompasso não aparece. Na automação não há ninguém
 * digitando: o nó guarda uma EXPRESSÃO por posição, e ela é resolvida contra o
 * lead no momento do envio.
 *
 * ⚠️ VAZIO NÃO É INOFENSIVO. A Meta recusa parâmetro vazio, e uma recusa dessas
 * chega por callback — depois de o vendedor achar que a mensagem saiu. Por isso
 * o vazio é DEVOLVIDO como vazio, visível, em vez de virar espaço ou sumir:
 * quem chama precisa poder barrar o envio antes de gastá-lo.
 */

/** Resolve as variáveis do produto num texto. Injetado por quem chama. */
export type ResolvedorDeVariaveis = (texto: string) => Promise<string>;

/**
 * O mapeamento que o nó guardou: posição do template → expressão do produto.
 *
 * `{ "1": "{{nome}}", "2": "Promoção de agosto" }` — a segunda é fixa, e isso é
 * legítimo: nem tudo varia por pessoa.
 */
export type MapeamentoDeVariaveis = Record<string, string>;

export async function resolverValoresDoTemplate(
  mapeamento: MapeamentoDeVariaveis,
  resolver: ResolvedorDeVariaveis,
): Promise<Record<string, string>> {
  const entradas = Object.entries(mapeamento ?? {});
  const resolvidas = await Promise.all(
    entradas.map(async ([posicao, expressao]) => {
      // Resolve mesmo quando não parece ter variável: o texto pode misturar
      // ("Sr. {{nome}}"), e decidir por `includes("{{")` aqui só adiantaria uma
      // otimização que o resolvedor já faz.
      const valor = await resolver(String(expressao ?? ""));
      return [posicao, valor] as const;
    }),
  );

  return Object.fromEntries(resolvidas);
}

// ─── A regra composta ────────────────────────────────────────────────────────

import type { NotificameTemplate } from "./notificame-templates.ts";
import {
  midiaDeExemploDoCabecalho,
  montarComponentesDeEnvio,
  pendenciasDeEnvio,
  previewDoTemplate,
  rotulosDosBotoes,
  type ComponenteDeEnvio,
} from "./template-send.ts";

export type EnvioDeTemplatePreparado =
  | {
    ok: true;
    components: ComponenteDeEnvio[];
    /** O texto que a CONVERSA vai exibir. Ver o ⚠️ abaixo. */
    previewText: string;
    buttonLabels: string[];
    headerMediaUrl: string | null;
  }
  | { ok: false; pendencias: string[] };

/**
 * Tudo o que a automação precisa decidir antes de mandar um template.
 *
 * Junta as quatro decisões num lugar só — resolver os valores, conferir o que
 * falta, montar os componentes e produzir o texto de exibição — para que prever
 * o comportamento não exija ler quatro arquivos.
 *
 * ⚠️ O `previewText` NÃO é enfeite. A Meta renderiza o corpo do lado dela, e a
 * linha gravada nasceria sem texto: a conversa exibiria "Mensagem interativa" no
 * lugar da mensagem. Só quem tem o corpo aprovado e os parâmetros juntos
 * consegue reproduzir o que ela vai mostrar — e é aqui que os dois estão.
 *
 * ⚠️ PENDÊNCIA BARRA O ENVIO. A Meta recusa parâmetro vazio, e a recusa dela
 * chega por callback, depois de o vendedor achar que mandou. Um erro legível no
 * passo da execução vale mais que uma mensagem que some.
 */
export async function prepararEnvioDeTemplate(params: {
  template: NotificameTemplate;
  mapeamento: MapeamentoDeVariaveis;
  resolver: ResolvedorDeVariaveis;
  /** Arquivo escolhido no nó. Sem ele, vale o que veio aprovado com o template. */
  headerMediaUrl?: string | null;
}): Promise<EnvioDeTemplatePreparado> {
  const valores = await resolverValoresDoTemplate(params.mapeamento, params.resolver);

  // A imagem que a Meta guarda junto do template aprovado é o padrão: pedir
  // upload de algo que ela já tem seria retrabalho, e foi o que o seletor do
  // chat fazia antes de ler o campo de exemplo.
  const midia = params.headerMediaUrl?.trim() || midiaDeExemploDoCabecalho(params.template);

  const pendencias = pendenciasDeEnvio(params.template, valores, midia);
  if (pendencias.length > 0) return { ok: false, pendencias };

  return {
    ok: true,
    components: montarComponentesDeEnvio(params.template, valores, midia),
    previewText: previewDoTemplate(params.template, valores),
    buttonLabels: rotulosDosBotoes(params.template),
    headerMediaUrl: midia,
  };
}
