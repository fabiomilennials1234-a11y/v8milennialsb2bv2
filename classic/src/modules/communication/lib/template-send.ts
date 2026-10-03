/**
 * O que preencher num template aprovado, e o corpo que sai daí. PURO.
 *
 * ⚠️ TEM UM GÊMEO: `supabase/functions/_shared/template-send.ts`. O executor de
 * workflow roda em outro runtime e não enxerga `src/`, e este arquivo nunca é
 * importado de lá. MUDOU AQUI? MUDE LÁ —
 * `tests/unit/template-send-twin.test.ts` roda os mesmos casos nos dois e fica
 * vermelho quando divergem.
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
 * A mídia de exemplo que veio APROVADA com o template.
 *
 * A Meta guarda o arquivo do cabeçalho junto do template e o devolve na
 * listagem, em `example.header_handle`. Usá-lo como padrão é a diferença entre
 * "escolha a imagem toda vez" e "manda". Quem quiser outra troca no seletor.
 *
 * `null` quando o template não tem cabeçalho de mídia ou quando o fornecedor não
 * devolveu o exemplo — e aí o seletor pede o arquivo, que é o comportamento
 * correto, não um erro.
 */
export function midiaDeExemploDoCabecalho(
  template: NotificameTemplate,
): string | null {
  const header = componenteDe(template, "HEADER");
  const exemplo = (header?.example ?? {}) as Record<string, unknown>;

  // `header_handle` é o nome na Graph. Os outros dois aparecem em respostas de
  // intermediários; aceitar os três custa uma linha e evita depender de qual
  // deles o fornecedor escolheu repassar.
  for (const chave of ["header_handle", "header_url", "header_image"]) {
    const bruto = exemplo[chave];
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof valor === "string" && valor.trim().startsWith("http")) {
      return valor.trim();
    }
  }
  return null;
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
  type: "header" | "body" | "button";
  /** Só em `button`: qual espécie de botão recebe o parâmetro. */
  sub_type?: "url" | "quick_reply";
  /** Só em `button`: a POSIÇÃO do botão dentro do componente BUTTONS, em texto. */
  index?: string;
  parameters: Array<ParametroDeTexto | ParametroDeMidia>;
}

/**
 * Os botões de um template que carregam parte variável.
 *
 * ⚠️ Os `{{n}}` de um botão são INDEPENDENTES dos do corpo — cada botão recomeça
 * em `{{1}}`. É por isso que o valor vem num mapa próprio, indexado pela POSIÇÃO
 * do botão: reaproveitar o mapa do corpo entregaria o nome do cliente como
 * número de pedido, e a Meta aceitaria sem reclamar.
 */
/** Os botões do template, na ordem — para mostrar antes de enviar. */
export function rotulosDosBotoes(template: NotificameTemplate): string[] {
  const componente = template.components?.find(
    (c) => (c.type ?? "").toUpperCase() === "BUTTONS",
  );
  const botoes = Array.isArray(componente?.buttons) ? componente!.buttons : [];

  return botoes
    .map((b) => ((b ?? {}) as { text?: string }).text?.trim() ?? "")
    .filter((t) => t !== "");
}

export function botoesComVariavel(
  template: NotificameTemplate,
): Array<{ index: number; texto: string }> {
  const componente = template.components?.find(
    (c) => (c.type ?? "").toUpperCase() === "BUTTONS",
  );
  const botoes = Array.isArray(componente?.buttons) ? componente!.buttons : [];

  return botoes
    .map((b, index) => {
      const x = (b ?? {}) as { type?: string; text?: string; url?: string };
      const temVariavel = /\{\{\s*\d+\s*\}\}/.test(x.url ?? "");
      return (x.type ?? "").toUpperCase() === "URL" && temVariavel
        ? { index, texto: (x.text ?? "").trim() }
        : null;
    })
    .filter((x): x is { index: number; texto: string } => x !== null);
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
  /** Valor da parte variável de cada botão de link, pela POSIÇÃO do botão. */
  valoresDosBotoes?: Record<number, string>,
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


  // BOTÕES. Só o que tem variável viaja — um componente para um botão estático
  // é parâmetro a mais, e a Meta recusa por contagem.
  for (const botao of botoesComVariavel(template)) {
    const valor = (valoresDosBotoes?.[botao.index] ?? "").trim();
    if (!valor) continue;
    out.push({
      type: "button",
      sub_type: "url",
      // `index` é STRING no envelope da Meta, e é a posição dentro de BUTTONS —
      // não a ordem em que a tela desenhou.
      index: String(botao.index),
      parameters: [{ type: "text", text: valor }],
    });
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
  valoresDosBotoes?: Record<number, string>,
): string[] {
  const faltas = variaveisFaltando(template, valores).map((t) => `{{${t}}}`);

  // A parte variável do link não é `{{n}}` de texto nenhum — não aparece no
  // corpo nem no cabeçalho —, então `variaveisFaltando` sozinha a deixa passar.
  // É a mesma armadilha da mídia de cabeçalho, e o mesmo desfecho: recusa por
  // callback, depois de o vendedor achar que mandou.
  for (const botao of botoesComVariavel(template)) {
    if (!(valoresDosBotoes?.[botao.index] ?? "").trim()) {
      faltas.push(`link do botão "${botao.texto}"`);
    }
  }
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
