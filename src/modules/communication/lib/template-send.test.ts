/**
 * O corpo que sai quando o vendedor manda um template.
 *
 * Este é o único caminho fora da janela de 24 horas — a mensagem que depende
 * dele é a que já não pode ser mandada de outro jeito. Um parâmetro na posição
 * errada faz a Meta recusar com mensagem genérica: a mensagem não chega e o
 * motivo não aparece em lugar nenhum.
 */
import { describe, expect, it } from "vitest";

import type { NotificameTemplate } from "../hooks/useNotificameTemplates";
import {
  formatoDeMidiaDoCabecalho,
  montarComponentesDeEnvio,
  pendenciasDeEnvio,
  previewDoTemplate,
  templateSemVariaveis,
  tokensDoTexto,
  variaveisDoTemplate,
  variaveisFaltando,
} from "./template-send";

const tpl = (components: NotificameTemplate["components"]): NotificameTemplate => ({
  name: "boas_vindas_teste",
  id: "1",
  language: "pt_BR",
  status: "APPROVED",
  category: "UTILITY",
  parameterFormat: "POSITIONAL",
  components,
});

describe("tokensDoTexto", () => {
  it("lê na ordem em que aparecem, sem repetir", () => {
    expect(tokensDoTexto("Olá {{1}}, seu pedido {{2}} — obrigado, {{1}}"))
      .toEqual(["1", "2"]);
  });

  it("aceita variável nomeada", () => {
    expect(tokensDoTexto("Olá {{nome}}")).toEqual(["nome"]);
  });

  it("texto sem variável, vazio ou ausente devolve lista vazia", () => {
    expect(tokensDoTexto("Olá, tudo bem?")).toEqual([]);
    expect(tokensDoTexto("")).toEqual([]);
    expect(tokensDoTexto(null)).toEqual([]);
  });
});

describe("variaveisDoTemplate", () => {
  it("junta cabeçalho e corpo, sem duplicar", () => {
    const v = variaveisDoTemplate(tpl([
      { type: "HEADER", format: "TEXT", text: "Pedido {{1}}" },
      { type: "BODY", text: "Olá {{2}}, o pedido {{1}} saiu" },
    ]));

    expect(v.header).toEqual(["1"]);
    expect(v.body).toEqual(["2", "1"]);
    expect(v.todas).toEqual(["1", "2"]);
  });

  it("IGNORA o rodapé — a Meta não aceita variável nele", () => {
    // Procurar ali produziria um campo fantasma no formulário: o vendedor
    // preencheria algo que nunca é enviado.
    const v = variaveisDoTemplate(tpl([
      { type: "BODY", text: "Olá" },
      { type: "FOOTER", text: "Responda {{1}} para sair" },
    ]));

    expect(v.todas).toEqual([]);
  });

  it("template sem variável é reconhecido", () => {
    expect(templateSemVariaveis(tpl([{ type: "BODY", text: "Olá, tudo bem?" }]))).toBe(true);
    expect(templateSemVariaveis(tpl([{ type: "BODY", text: "Olá {{1}}" }]))).toBe(false);
  });
});

describe("montarComponentesDeEnvio", () => {
  it("monta no formato da Graph, com os parâmetros na ORDEM DO TEXTO", () => {
    const componentes = montarComponentesDeEnvio(
      tpl([{ type: "BODY", text: "Olá {{1}}, pedido {{2}}" }]),
      { "2": "1234", "1": "Maria" }, // de propósito fora de ordem
    );

    // A Meta casa parâmetro com {{n}} por POSIÇÃO. Seguir a ordem das chaves do
    // objeto entregaria o número do pedido no lugar do nome.
    expect(componentes).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "1234" }] },
    ]);
  });

  it("cabeçalho vira componente próprio, antes do corpo", () => {
    const componentes = montarComponentesDeEnvio(
      tpl([
        { type: "HEADER", format: "TEXT", text: "Pedido {{1}}" },
        { type: "BODY", text: "Olá {{2}}" },
      ]),
      { "1": "1234", "2": "Maria" },
    );

    expect(componentes.map((c) => c.type)).toEqual(["header", "body"]);
    const p = componentes[0].parameters[0];
    expect(p.type === "text" && p.text).toBe("1234");
  });

  it("template SEM variável não manda componente nenhum", () => {
    // `parameters: []` num componente que o template não declara como variável é
    // recusado pela Meta.
    expect(montarComponentesDeEnvio(tpl([{ type: "BODY", text: "Olá!" }]), {})).toEqual([]);
  });

  it("apara espaços do valor digitado", () => {
    const c = montarComponentesDeEnvio(tpl([{ type: "BODY", text: "Olá {{1}}" }]), { "1": "  Maria  " });
    const p = c[0].parameters[0];
    expect(p.type === "text" && p.text).toBe("Maria");
  });
});

describe("variaveisFaltando", () => {
  it("lista o que ainda está em branco", () => {
    const t = tpl([{ type: "BODY", text: "Olá {{1}}, pedido {{2}}" }]);

    expect(variaveisFaltando(t, { "1": "Maria" })).toEqual(["2"]);
    expect(variaveisFaltando(t, { "1": "Maria", "2": "  " })).toEqual(["2"]);
    expect(variaveisFaltando(t, { "1": "Maria", "2": "1234" })).toEqual([]);
  });
});

describe("previewDoTemplate", () => {
  it("mostra a mensagem pronta, com cabeçalho e rodapé", () => {
    const texto = previewDoTemplate(
      tpl([
        { type: "HEADER", format: "TEXT", text: "Pedido {{1}}" },
        { type: "BODY", text: "Olá {{2}}, já saiu para entrega." },
        { type: "FOOTER", text: "Equipe Comercial" },
      ]),
      { "1": "1234", "2": "Maria" },
    );

    expect(texto).toBe("Pedido 1234\n\nOlá Maria, já saiu para entrega.\n\nEquipe Comercial");
  });

  it("variável ainda em branco continua visível como variável", () => {
    // Apagar o token faria a frase parecer completa e errada — "Olá , tudo bem?".
    expect(previewDoTemplate(tpl([{ type: "BODY", text: "Olá {{1}}, tudo bem?" }]), {}))
      .toBe("Olá {{1}}, tudo bem?");
  });
});


/**
 * CABEÇALHO DE MÍDIA — o defeito 132012.
 *
 * Medido em produção (19/08), enviando `confirmacao_responsavel_utilidade_v2`:
 *
 *   132012 Parameter format does not match format in the created template
 *   details: header: Format mismatch, expected IMAGE, received UNKNOWN
 *
 * O template tem cabeçalho de IMAGEM. O seletor o listava como enviável, montava
 * só o componente de corpo, e a Meta recusava por callback — depois de o vendedor
 * achar que tinha mandado.
 */
describe("cabeçalho de mídia", () => {
  const comImagem = tpl([
    { type: "HEADER", format: "IMAGE" },
    { type: "BODY", text: "Olá {{1}}, tudo bem?" },
  ]);

  it("reconhece o formato que exige arquivo", () => {
    expect(formatoDeMidiaDoCabecalho(comImagem)).toBe("IMAGE");
    expect(formatoDeMidiaDoCabecalho(tpl([{ type: "HEADER", format: "TEXT", text: "Oi" }]))).toBeNull();
    expect(formatoDeMidiaDoCabecalho(tpl([{ type: "BODY", text: "Oi" }]))).toBeNull();
  });

  it("monta o parâmetro no formato da Graph — chave repetindo o tipo, com `link`", () => {
    const componentes = montarComponentesDeEnvio(
      comImagem,
      { "1": "Samuel" },
      "https://storage.example/capa.jpg",
    );

    expect(componentes[0]).toEqual({
      type: "header",
      parameters: [{ type: "image", image: { link: "https://storage.example/capa.jpg" } }],
    });
    // O corpo continua vindo depois, com as variáveis dele.
    expect(componentes[1]).toMatchObject({ type: "body" });
  });

  it("PENDÊNCIA: sem o arquivo, o envio não sai — e diz o que falta", () => {
    // É a tranca que faltava. A mídia não é `{{n}}`, não aparece em texto nenhum,
    // e mesmo assim a Meta a exige: por isso `variaveisFaltando` sozinha deixava
    // passar.
    expect(pendenciasDeEnvio(comImagem, { "1": "Samuel" })).toEqual(["imagem do cabeçalho"]);
    expect(pendenciasDeEnvio(comImagem, {}, "https://x/y.jpg")).toEqual(["{{1}}"]);
    expect(pendenciasDeEnvio(comImagem, { "1": "Samuel" }, "https://x/y.jpg")).toEqual([]);
  });

  it("nomeia o arquivo pelo tipo — vídeo e documento também", () => {
    const comVideo = tpl([{ type: "HEADER", format: "VIDEO" }, { type: "BODY", text: "Oi" }]);
    const comDoc = tpl([{ type: "HEADER", format: "DOCUMENT" }, { type: "BODY", text: "Oi" }]);

    expect(pendenciasDeEnvio(comVideo, {})).toEqual(["vídeo do cabeçalho"]);
    expect(pendenciasDeEnvio(comDoc, {})).toEqual(["documento do cabeçalho"]);
  });

  it("template de texto não ganha componente de mídia nem se mandarem URL", () => {
    const soTexto = tpl([{ type: "BODY", text: "Olá {{1}}" }]);
    const c = montarComponentesDeEnvio(soTexto, { "1": "Maria" }, "https://x/y.jpg");

    expect(c.map((x) => x.type)).toEqual(["body"]);
  });
});
