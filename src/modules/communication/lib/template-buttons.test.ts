/**
 * Os botões de um template do WhatsApp.
 *
 * ─── POR QUE ISSO IMPORTA MAIS QUE UM CAMPO A MAIS NO FORMULÁRIO ────────────
 *
 * Template é a ÚNICA mensagem que a Meta aceita fora da janela de 24 horas. Sem
 * botão, ele só entrega texto e espera que a pessoa digite — e medimos o que
 * acontece quando existe um botão: na Goletric Pinheiros, 152 pessoas tocaram em
 * "Liberar catálogo" em dois dias. É a diferença entre avisar e ser respondido.
 *
 * A Meta recusa o template inteiro por regra de botão violada, horas depois da
 * criação e com mensagem genérica. Cada regra aqui é uma recusa que não
 * acontece.
 */
import { describe, expect, it } from "vitest";

import { montarComponenteDeBotoes, problemasDosBotoes } from "./template-buttons";

describe("montarComponenteDeBotoes", () => {
  it("monta o componente no formato da Meta", () => {
    const c = montarComponenteDeBotoes([
      { tipo: "QUICK_REPLY", texto: "Sim" },
      { tipo: "QUICK_REPLY", texto: "Não" },
    ]);

    expect(c).toEqual({
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Sim" },
        { type: "QUICK_REPLY", text: "Não" },
      ],
    });
  });

  it("sem botão nenhum não emite componente", () => {
    // `{type:"BUTTONS", buttons:[]}` é recusado pela Meta. Template sem botão
    // simplesmente não declara o componente.
    expect(montarComponenteDeBotoes([])).toBeNull();
  });
});

describe("problemasDosBotoes — o que a Meta recusa", () => {
  const qr = (texto: string) => ({ tipo: "QUICK_REPLY" as const, texto });

  it("passa quando está tudo certo", () => {
    expect(problemasDosBotoes([qr("Sim"), qr("Não")])).toEqual([]);
    expect(problemasDosBotoes([])).toEqual([]);
  });

  it("no máximo 10 botões no total", () => {
    const onze = Array.from({ length: 11 }, (_, i) => qr(`Opção ${i}`));
    expect(problemasDosBotoes(onze)).toContain("No máximo 10 botões por template.");
  });

  it("texto do botão até 25 caracteres", () => {
    // O limite é da Meta e o vendedor não tem como saber: ele escreve a frase
    // que faz sentido e recebe uma recusa genérica horas depois.
    expect(problemasDosBotoes([qr("Quero falar com um vendedor agora mesmo")]))
      .toContain('"Quero falar com um vendedor agora mesmo" passa de 25 caracteres.');
  });

  it("no máximo 1 botão de telefone e 2 de link", () => {
    const problemas = problemasDosBotoes([
      { tipo: "PHONE_NUMBER", texto: "Ligar", telefone: "+5544999" },
      { tipo: "PHONE_NUMBER", texto: "Ligar 2", telefone: "+5544888" },
      { tipo: "URL", texto: "Site", url: "https://a.com" },
      { tipo: "URL", texto: "Loja", url: "https://b.com" },
      { tipo: "URL", texto: "Blog", url: "https://c.com" },
    ]);

    expect(problemas).toContain("No máximo 1 botão de telefone.");
    expect(problemas).toContain("No máximo 2 botões de link.");
  });

  it("link precisa de URL e telefone precisa de número", () => {
    expect(problemasDosBotoes([{ tipo: "URL", texto: "Site" }]))
      .toContain('"Site" é um botão de link e está sem endereço.');
    expect(problemasDosBotoes([{ tipo: "PHONE_NUMBER", texto: "Ligar" }]))
      .toContain('"Ligar" é um botão de telefone e está sem número.');
  });
});

/**
 * A URL COM PARTE VARIÁVEL.
 *
 * `https://loja.com/promo/{{1}}` deixa o link mudar por envio — é o que permite
 * um template só levar cada cliente ao pedido dele. A Meta impõe duas coisas
 * que já nos custaram uma recusa em outro campo:
 *
 *   1. a variável fica no FIM da URL, e em nenhum outro lugar;
 *   2. o `example` é OBRIGATÓRIO — a mesma regra do `body_text`, que morreu no
 *      `readDraft` e fez um template ser recusado horas depois, sem motivo
 *      legível.
 */
describe("URL com parte variável", () => {
  it("leva o exemplo junto, como a Meta exige", () => {
    const c = montarComponenteDeBotoes([
      { tipo: "URL", texto: "Ver pedido", url: "https://loja.com/p/{{1}}", exemploDaUrl: "4471" },
    ]);

    expect(c?.buttons[0]).toEqual({
      type: "URL",
      text: "Ver pedido",
      url: "https://loja.com/p/{{1}}",
      example: ["https://loja.com/p/4471"],
    });
  });

  it("variável no meio da URL é recusa — a Meta só aceita no fim", () => {
    expect(
      problemasDosBotoes([
        { tipo: "URL", texto: "Ver", url: "https://loja.com/{{1}}/detalhe" },
      ]),
    ).toContain('"Ver": a parte variável do link só pode ficar no fim do endereço.');
  });

  it("variável sem exemplo é recusa — mesma regra que já nos custou um template", () => {
    expect(
      problemasDosBotoes([{ tipo: "URL", texto: "Ver", url: "https://loja.com/p/{{1}}" }]),
    ).toContain('"Ver": preencha um exemplo para a parte variável do link.');
  });

  it("URL sem variável não pede exemplo nenhum", () => {
    const c = montarComponenteDeBotoes([
      { tipo: "URL", texto: "Site", url: "https://loja.com" },
    ]);

    expect(c?.buttons[0]).toEqual({ type: "URL", text: "Site", url: "https://loja.com" });
    expect(problemasDosBotoes([{ tipo: "URL", texto: "Site", url: "https://loja.com" }])).toEqual([]);
  });
});
