/**
 * O que preencher num template aprovado, e o corpo que sai daí. PURO.
 *
 * ─── POR QUE ISTO NÃO MORA NO COMPONENTE ────────────────────────────────────
 *
 * Enviar template é o ÚNICO caminho fora da janela de 24 horas: a mensagem que
 * depende disto é a que o vendedor manda quando já não pode mandar mais nada. Um
 * parâmetro na posição errada faz a Meta recusar com mensagem genérica — a
 * mensagem não chega, e o motivo não aparece em lugar nenhum.
 *
 * Daí a decisão ficar aqui, em função pura com teste, e não dentro do `onClick`.
 */
import type {
  NotificameTemplate,
  NotificameTemplateComponent,
} from "../hooks/useNotificameTemplates";

const VARIABLE_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Os tokens de `{{…}}` de um texto, na ordem, sem repetir. */
export function tokensDoTexto(texto: string | null | undefined): string[] {
  const vistos: string[] = [];
  for (const m of (texto ?? "").matchAll(VARIABLE_RE)) {
    const token = (m[1] ?? "").trim();
    if (token && !vistos.includes(token)) vistos.push(token);
  }
  return vistos;
}

function componenteDe(
  template: NotificameTemplate,
  tipo: string,
): NotificameTemplateComponent | undefined {
  return template.components?.find((c) => (c.type ?? "").toUpperCase() === tipo);
}

export interface VariaveisDoTemplate {
  header: string[];
  body: string[];
  /** Todos, sem repetir, para a tela pedir um campo por variável. */
  todas: string[];
}

/** Os formatos de cabeçalho que exigem um ARQUIVO, não texto. */
export type FormatoDeMidia = "IMAGE" | "VIDEO" | "DOCUMENT";

/**
 * O formato de mídia do cabeçalho, quando ele é mídia. `null` para cabeçalho de
 * texto ou ausente.
 *
 * ⚠️ Template com cabeçalho de mídia EXIGE o componente de header no envio, com o
 * arquivo. Sem ele a Meta recusa — medido em produção (19/08):
 *
 *   132012 Parameter format does not match format in the created template
 *   details: header: Format mismatch, expected IMAGE, received UNKNOWN
 *
 * O seletor listava esses templates e mandava só o corpo. A recusa chegava por
 * callback, depois do vendedor achar que tinha mandado.
 */
export function formatoDeMidiaDoCabecalho(
  template: NotificameTemplate,
): FormatoDeMidia | null {
  const header = template.components?.find(
    (c) => (c.type ?? "").toUpperCase() === "HEADER",
  );
  if (!header) return null;
  const formato = (header.format ?? "TEXT").toUpperCase();
  return formato === "IMAGE" || formato === "VIDEO" || formato === "DOCUMENT"
    ? formato
    : null;
}

/**
 * As variáveis que o vendedor precisa preencher.
 *
 * O RODAPÉ fica de fora de propósito: a Meta não aceita variável nele, e a nossa
 * validação de criação já recusa — procurar ali só produziria campo fantasma.
 */
export function variaveisDoTemplate(template: NotificameTemplate): VariaveisDoTemplate {
  const header = tokensDoTexto(componenteDe(template, "HEADER")?.text);
  const body = tokensDoTexto(componenteDe(template, "BODY")?.text);
  const todas = [...header, ...body.filter((t) => !header.includes(t))];
  return { header, body, todas };
}

/** True quando dá para enviar sem pedir nada ao vendedor. */
export function templateSemVariaveis(template: NotificameTemplate): boolean {
  return variaveisDoTemplate(template).todas.length === 0;
}

/** Parâmetro de texto — o `{{n}}` do corpo ou de um cabeçalho de texto. */
export interface ParametroDeTexto {
  type: "text";
  text: string;
}

/**
 * Parâmetro de MÍDIA do cabeçalho. A chave repete o tipo, e dentro dela vai um
 * `link` — formato da Graph, não escolha nossa. `url` no lugar de `link` produz o
 * mesmo 132012 de quando não se manda nada.
 */
export type ParametroDeMidia =
  | { type: "image"; image: { link: string } }
  | { type: "video"; video: { link: string } }
  | { type: "document"; document: { link: string } };

export interface ComponenteDeEnvio {
  type: "header" | "body";
  parameters: Array<ParametroDeTexto | ParametroDeMidia>;
}

/**
 * Monta os componentes no formato da Graph, que é o que o provider converte.
 *
 * ⚠️ A ORDEM É A DO TEXTO, não a do objeto de valores. A Meta casa parâmetro com
 * `{{n}}` por POSIÇÃO — o primeiro parâmetro vira `{{1}}`, e ninguém confere
 * nome. Ordenar pelas chaves de um objeto (que em JS seguem ordem de inserção)
 * trocaria os valores no dia em que a tela preenchesse fora de ordem, e o
 * sintoma seria o cliente recebendo o número do pedido no lugar do nome.
 *
 * Componente sem variável NÃO entra: a Meta recusa `parameters: []` num
 * componente que o template não declara como variável.
 */
export function montarComponentesDeEnvio(
  template: NotificameTemplate,
  valores: Record<string, string>,
  /** URL pública do arquivo, quando o cabeçalho é de mídia. */
  midiaDoCabecalho?: string | null,
): ComponenteDeEnvio[] {
  const vars = variaveisDoTemplate(template);
  const out: ComponenteDeEnvio[] = [];

  const parametrosDe = (tokens: string[]) =>
    tokens.map((t) => ({ type: "text" as const, text: (valores[t] ?? "").trim() }));

  // CABEÇALHO DE MÍDIA. O formato do parâmetro segue o da Graph: a chave é o
  // próprio tipo em minúscula, e dentro dela um `link`. Trocar por `url` faz a
  // Meta responder o mesmo 132012 de quando não se manda nada.
  const formatoMidia = formatoDeMidiaDoCabecalho(template);
  const url = midiaDoCabecalho?.trim();
  if (formatoMidia && url) {
    const parametro: ParametroDeMidia =
      formatoMidia === "IMAGE" ? { type: "image", image: { link: url } }
        : formatoMidia === "VIDEO" ? { type: "video", video: { link: url } }
          : { type: "document", document: { link: url } };
    out.push({ type: "header", parameters: [parametro] });
  } else if (vars.header.length > 0) {
    out.push({ type: "header", parameters: parametrosDe(vars.header) });
  }
  if (vars.body.length > 0) {
    out.push({ type: "body", parameters: parametrosDe(vars.body) });
  }

  return out;
}

/** As variáveis que ainda estão em branco — a tela usa para travar o envio. */
export function variaveisFaltando(
  template: NotificameTemplate,
  valores: Record<string, string>,
): string[] {
  return variaveisDoTemplate(template).todas.filter((t) => !(valores[t] ?? "").trim());
}

/**
 * O que ainda impede o envio. Lista vazia = pode mandar.
 *
 * Existe separado de `variaveisFaltando` porque a mídia do cabeçalho não é uma
 * variável: ela não aparece como `{{n}}` em texto nenhum, e mesmo assim a Meta a
 * exige. Foi exatamente por isso que o seletor deixou passar.
 */
export function pendenciasDeEnvio(
  template: NotificameTemplate,
  valores: Record<string, string>,
  midiaDoCabecalho?: string | null,
): string[] {
  const faltas = variaveisFaltando(template, valores).map((t) => `{{${t}}}`);
  const formato = formatoDeMidiaDoCabecalho(template);
  if (formato && !midiaDoCabecalho?.trim()) {
    faltas.unshift(
      formato === "IMAGE" ? "imagem do cabeçalho"
        : formato === "VIDEO" ? "vídeo do cabeçalho"
          : "documento do cabeçalho",
    );
  }
  return faltas;
}

/**
 * O texto do template com os valores aplicados — o que o cliente vai ler.
 *
 * Existe pelo mesmo motivo do preview do editor: mandar uma mensagem sem ver como
 * ela fica é o caminho curto para o cliente receber "Olá {{1}}".
 */
export function previewDoTemplate(
  template: NotificameTemplate,
  valores: Record<string, string>,
): string {
  const aplicar = (texto: string | null | undefined) =>
    (texto ?? "").replace(VARIABLE_RE, (bruto, token: string) => {
      const v = (valores[(token ?? "").trim()] ?? "").trim();
      return v || bruto;
    });

  const partes = [
    aplicar(componenteDe(template, "HEADER")?.text),
    aplicar(componenteDe(template, "BODY")?.text),
    aplicar(componenteDe(template, "FOOTER")?.text),
  ].filter((p) => p.trim());

  return partes.join("\n\n");
}
