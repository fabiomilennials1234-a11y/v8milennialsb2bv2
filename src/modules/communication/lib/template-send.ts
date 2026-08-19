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

export interface ComponenteDeEnvio {
  type: "header" | "body";
  parameters: Array<{ type: "text"; text: string }>;
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
): ComponenteDeEnvio[] {
  const vars = variaveisDoTemplate(template);
  const out: ComponenteDeEnvio[] = [];

  const parametrosDe = (tokens: string[]) =>
    tokens.map((t) => ({ type: "text" as const, text: (valores[t] ?? "").trim() }));

  if (vars.header.length > 0) {
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
