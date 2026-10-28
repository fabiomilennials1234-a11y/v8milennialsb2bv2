import { describe, expect, it } from "vitest";
import { splitQuotedReplyPrefix } from "./quotedReplyPrefix";

describe("splitQuotedReplyPrefix", () => {
  it("separa citação e corpo (aspas retas)", () => {
    expect(splitQuotedReplyPrefix('[Em resposta a: "Fechamos em 500k?"]\nesse é o valor')).toEqual({
      quoted: "Fechamos em 500k?",
      body: "esse é o valor",
    });
  });

  it("aspas curvas", () => {
    expect(splitQuotedReplyPrefix("[Em resposta a: “quanto custa?”]\nR$ 500")).toEqual({
      quoted: "quanto custa?",
      body: "R$ 500",
    });
  });

  it("citação multilinha", () => {
    expect(splitQuotedReplyPrefix('[Em resposta a: "linha 1\nlinha 2"]\nok')).toEqual({
      quoted: "linha 1\nlinha 2",
      body: "ok",
    });
  });

  it("aspas dentro do texto citado", () => {
    expect(splitQuotedReplyPrefix('[Em resposta a: "ele disse "sim" ontem"]\nok')).toEqual({
      quoted: 'ele disse "sim" ontem',
      body: "ok",
    });
  });

  it("citação truncada com reticências e CRLF", () => {
    expect(splitQuotedReplyPrefix('[Em resposta a: "abc…"]\r\ncorpo')).toEqual({ quoted: "abc…", body: "corpo" });
  });

  it("só a citação (resposta sem corpo)", () => {
    expect(splitQuotedReplyPrefix('[Em resposta a: "[imagem]"]')).toEqual({ quoted: "[imagem]", body: "" });
  });

  it("texto com a frase no meio não é prefixo", () => {
    const texto = 'oi [Em resposta a: "x"]\nfim';
    expect(splitQuotedReplyPrefix(texto)).toEqual({ quoted: null, body: texto });
  });

  it("null, vazio e texto comum passam intactos", () => {
    expect(splitQuotedReplyPrefix(null)).toEqual({ quoted: null, body: "" });
    expect(splitQuotedReplyPrefix("")).toEqual({ quoted: null, body: "" });
    expect(splitQuotedReplyPrefix("bom dia")).toEqual({ quoted: null, body: "bom dia" });
  });
});
