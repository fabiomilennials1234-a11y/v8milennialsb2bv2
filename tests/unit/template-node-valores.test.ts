// @vitest-environment node
/**
 * Os valores que preenchem um template disparado por AUTOMAÇÃO — issue #1688.
 *
 * No chat, o vendedor digita o valor de cada variável na hora. Na automação não
 * há ninguém digitando: o nó guarda uma EXPRESSÃO por variável — `{{nome}}`,
 * `{{empresa}}` — e ela é resolvida contra o lead no momento do envio.
 *
 * ⚠️ O DESCOMPASSO QUE ISTO ATRAVESSA: a Meta numera as variáveis por POSIÇÃO
 * (`{{1}}`, `{{2}}`) e o produto as nomeia (`{{nome}}`). O nó mapeia uma coisa
 * na outra, e é aqui que o mapeamento vira valor.
 */
import { describe, expect, it } from "vitest";

import { prepararEnvioDeTemplate, resolverValoresDoTemplate } from "../../supabase/functions/_shared/template-node-valores.ts";

/** Dublê do resolvedor do produto: troca `{{chave}}` pelo que o lead tem. */
const resolvedor = async (texto: string) =>
  texto
    .replaceAll("{{nome}}", "Maria")
    .replaceAll("{{empresa}}", "Chiquê")
    .replaceAll("{{inexistente}}", "");

describe("resolverValoresDoTemplate", () => {
  it("resolve a expressão de cada variável posicional", async () => {
    const r = await resolverValoresDoTemplate({ "1": "{{nome}}", "2": "{{empresa}}" }, resolvedor);

    expect(r).toEqual({ "1": "Maria", "2": "Chiquê" });
  });

  it("valor fixo passa inteiro — nem tudo varia por pessoa", async () => {
    const r = await resolverValoresDoTemplate({ "1": "Promoção de agosto" }, resolvedor);

    expect(r).toEqual({ "1": "Promoção de agosto" });
  });

  it("mistura expressão e texto na mesma variável", async () => {
    // O template pode ter "Olá {{1}}" e o nó querer "Sr. {{nome}}".
    const r = await resolverValoresDoTemplate({ "1": "Sr. {{nome}}" }, resolvedor);

    expect(r).toEqual({ "1": "Sr. Maria" });
  });

  it("variável que o lead não tem vira VAZIO, e o vazio é sinalizado", async () => {
    // ⚠️ A Meta RECUSA parâmetro vazio. Mandar assim é uma mensagem que não
    // chega — e o vendedor achando que chegou. Quem chama precisa poder barrar
    // antes do envio, então o vazio não pode passar despercebido.
    const r = await resolverValoresDoTemplate({ "1": "{{inexistente}}" }, resolvedor);

    expect(r["1"]).toBe("");
  });

  it("mapeamento vazio devolve mapa vazio — template sem variável", async () => {
    expect(await resolverValoresDoTemplate({}, resolvedor)).toEqual({});
  });
});

/**
 * A REGRA COMPOSTA: o que sai quando a automação manda um template.
 *
 * Junta as quatro decisões numa só, para que prever o comportamento não exija
 * ler quatro arquivos: resolver os valores, conferir o que falta, montar os
 * componentes e produzir o texto que a conversa vai exibir.
 *
 * ⚠️ A Meta renderiza o corpo do lado dela. O texto que a conversa mostra tem de
 * viajar junto do envio — foi o que o chat precisou fazer, porque a linha
 * nascia sem texto e a conversa exibia "Mensagem interativa" no lugar da
 * mensagem.
 */
describe("prepararEnvioDeTemplate", () => {
  const tpl = (components: unknown[]) => ({
    name: "boas_vindas",
    id: "1",
    language: "pt_BR",
    status: "APPROVED",
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    components,
  }) as never;

  it("template pronto devolve componentes, texto e rótulos dos botões", async () => {
    const r = await prepararEnvioDeTemplate({
      template: tpl([
        { type: "BODY", text: "Olá {{1}}, tudo bem?" },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sim" }] },
      ]),
      mapeamento: { "1": "{{nome}}" },
      resolver: resolvedor,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Maria" }] },
    ]);
    expect(r.previewText).toBe("Olá Maria, tudo bem?");
    expect(r.buttonLabels).toEqual(["Sim"]);
  });

  it("variável que resolveu VAZIO barra o envio, dizendo qual", async () => {
    // A Meta recusa parâmetro vazio, e a recusa chega por callback — depois de
    // o vendedor achar que mandou. Barrar aqui é a diferença entre um erro
    // legível no passo e uma mensagem que some.
    const r = await prepararEnvioDeTemplate({
      template: tpl([{ type: "BODY", text: "Olá {{1}}" }]),
      mapeamento: { "1": "{{inexistente}}" },
      resolver: resolvedor,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.pendencias).toContain("{{1}}");
  });

  it("cabeçalho de mídia sem arquivo barra o envio", async () => {
    const r = await prepararEnvioDeTemplate({
      template: tpl([{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Olá" }]),
      mapeamento: {},
      resolver: resolvedor,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.pendencias).toContain("imagem do cabeçalho");
  });

  it("cabeçalho de mídia usa a imagem que veio APROVADA com o template", async () => {
    // A Meta guarda o arquivo junto do template e o devolve na listagem. Pedir
    // upload de algo que ela já tem seria retrabalho.
    const r = await prepararEnvioDeTemplate({
      template: tpl([
        { type: "HEADER", format: "IMAGE", example: { header_handle: ["https://x/capa.jpg"] } },
        { type: "BODY", text: "Olá" },
      ]),
      mapeamento: {},
      resolver: resolvedor,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.headerMediaUrl).toBe("https://x/capa.jpg");
  });

  it("template sem variável não manda componente nenhum", async () => {
    const r = await prepararEnvioDeTemplate({
      template: tpl([{ type: "BODY", text: "Olá!" }]),
      mapeamento: {},
      resolver: resolvedor,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.components).toEqual([]);
  });
});
