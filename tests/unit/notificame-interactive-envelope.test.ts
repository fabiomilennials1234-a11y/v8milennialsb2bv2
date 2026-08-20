// @vitest-environment node
/**
 * O envelope das mensagens INTERATIVAS do canal oficial.
 *
 * ─── POR QUE O ENVELOPE É O RISCO, E NÃO A TELA ─────────────────────────────
 *
 * A forma intuitiva — `{type:"button", text, buttons:[…]}` — não falha alto: o
 * fornecedor ACEITA o corpo e a Meta recusa o envio depois. Foi assim que áudio
 * e imagem foram recusados no Direct em 17/08/2026 enquanto o texto passava, e o
 * operador recebeu a recusa sem motivo.
 *
 * Cada assertiva aqui é copiada da doc corrente do fornecedor
 * (app.notificame.com.br/docs/api.md, a versão de 167 KB que a SPA carrega — o
 * host `hub.` serve uma cópia velha, também com HTTP 200).
 *
 * ⚠️ NENHUM destes envelopes foi exercido contra conta viva ainda. A primeira
 * mensagem interativa real ainda não saiu.
 */
import { describe, expect, it } from "vitest";

import {
  toNotificameContactContent,
  toNotificameInteractiveContent,
  toNotificameLocationContent,
} from "../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts";

describe("botões", () => {
  it("monta `interactive.type = button`, com id por posição", () => {
    const c = toNotificameInteractiveContent(
      {
        tipo: "button",
        texto: "Podemos seguir?",
        opcoes: [{ titulo: "Sim" }, { titulo: "Não" }],
      },
      "whatsapp",
    );

    expect(c).toEqual({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Podemos seguir?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "1", title: "Sim" } },
            { type: "reply", reply: { id: "2", title: "Não" } },
          ],
        },
      },
    });
  });

  it("recusa acima de 3 — o teto é da Meta, e ela recusa o envio inteiro", () => {
    expect(() =>
      toNotificameInteractiveContent(
        {
          tipo: "button",
          texto: "Escolha",
          opcoes: [{ titulo: "A" }, { titulo: "B" }, { titulo: "C" }, { titulo: "D" }],
        },
        "whatsapp",
      )
    ).toThrow();
  });
});

describe("lista", () => {
  it("monta `interactive.type = list`, com uma seção e o rótulo do botão", () => {
    const c = toNotificameInteractiveContent(
      {
        tipo: "list",
        texto: "Veja os modelos",
        rotuloDaLista: "Ver catálogo",
        opcoes: [
          { titulo: "Cabo 6mm", descricao: "Rolo com 100m" },
          { titulo: "Cabo 10mm" },
        ],
      },
      "whatsapp",
    );

    expect(c).toEqual({
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Veja os modelos" },
        action: {
          button: "Ver catálogo",
          sections: [
            {
              title: "Opções",
              rows: [
                { id: "1", title: "Cabo 6mm", description: "Rolo com 100m" },
                { id: "2", title: "Cabo 10mm" },
              ],
            },
          ],
        },
      },
    });
  });

  it("sem rótulo do botão a lista não abre — o WhatsApp precisa dele", () => {
    expect(() =>
      toNotificameInteractiveContent(
        { tipo: "list", texto: "Veja", opcoes: [{ titulo: "A" }] },
        "whatsapp",
      )
    ).toThrow();
  });
});

describe("CTA com link", () => {
  it("monta `cta_url` com display_text e url dentro de action.parameters", () => {
    const c = toNotificameInteractiveContent(
      {
        tipo: "cta",
        texto: "Seu orçamento está pronto.",
        rodape: "Equipe Comercial",
        opcoes: [{ titulo: "Abrir orçamento" }],
        ctaUrl: "https://loja.com/orc/4471",
      },
      "whatsapp",
    );

    expect(c).toEqual({
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: "Seu orçamento está pronto." },
        footer: { text: "Equipe Comercial" },
        action: {
          name: "cta_url",
          parameters: {
            display_text: "Abrir orçamento",
            url: "https://loja.com/orc/4471",
          },
        },
      },
    });
  });
});

describe("o que NÃO existe neste canal", () => {
  it("enquete e carrossel são da Uazapi, não da Meta", () => {
    for (const tipo of ["poll", "carousel"] as const) {
      expect(() =>
        toNotificameInteractiveContent(
          { tipo, texto: "x", opcoes: [{ titulo: "A" }] },
          "whatsapp",
        )
      ).toThrow();
    }
  });

  it("Instagram não recebe estes envelopes", () => {
    // A doc do fornecedor tem Quick Reply para Instagram, com envelope PRÓPRIO.
    // Mandar o do WhatsApp ali seria inventar — e o fornecedor aceitaria o corpo
    // antes de a Meta recusar o envio.
    expect(() =>
      toNotificameInteractiveContent(
        { tipo: "button", texto: "x", opcoes: [{ titulo: "A" }] },
        "instagram",
      )
    ).toThrow();
  });

  it("sem opção nenhuma não há mensagem interativa", () => {
    expect(() =>
      toNotificameInteractiveContent({ tipo: "button", texto: "x", opcoes: [] }, "whatsapp")
    ).toThrow();
  });
});

/**
 * LOCALIZAÇÃO E CONTATO.
 *
 * Não são interativos, mas vêm do mesmo lugar do composer e têm o mesmo risco:
 * a forma intuitiva (`{type:"location", location:{…}}`, como a Graph aninha) é
 * ACEITA pelo fornecedor e recusada pela Meta depois. A doc dele põe os campos
 * NO NÍVEL do content, e é essa a diferença que este teste guarda.
 */
describe("localização", () => {
  it("põe as coordenadas no nível do content, não aninhadas", () => {
    expect(
      toNotificameLocationContent(
        { latitude: -25.510785, longitude: -48.310882, nome: "Loja Centro", endereco: "Rua X, 1" },
        "whatsapp",
      ),
    ).toEqual({
      type: "location",
      latitude: -25.510785,
      longitude: -48.310882,
      name: "Loja Centro",
      address: "Rua X, 1",
    });
  });

  it("coordenada zero viaja — é o golfo da Guiné, não ausência", () => {
    const c = toNotificameLocationContent({ latitude: 0, longitude: 0 }, "whatsapp");
    expect(c.latitude).toBe(0);
    expect(c.longitude).toBe(0);
  });

  it("sem coordenada não há mensagem", () => {
    expect(() =>
      toNotificameLocationContent({ latitude: NaN, longitude: 1 }, "whatsapp")
    ).toThrow();
  });
});

describe("contato", () => {
  it("monta o cartão com nome formatado e telefone", () => {
    expect(
      toNotificameContactContent(
        [{ nome: "Maria Souza", telefones: [{ numero: "+55 44 99999-9999" }] }],
        "whatsapp",
      ),
    ).toEqual({
      type: "contacts",
      contacts: [
        {
          name: { formatted_name: "Maria Souza", first_name: "Maria", last_name: "Souza" },
          phones: [{ phone: "+55 44 99999-9999" }],
        },
      ],
    });
  });

  it("nome de uma palavra não inventa sobrenome", () => {
    // `last_name: ""` num cartão é um campo vazio visível no aparelho do
    // destinatário. Ausente é diferente de vazio.
    const c = toNotificameContactContent(
      [{ nome: "Maria", telefones: [{ numero: "+5544999" }] }],
      "whatsapp",
    );

    expect((c.contacts as Array<{ name: Record<string, unknown> }>)[0].name)
      .toEqual({ formatted_name: "Maria", first_name: "Maria" });
  });

  it("cartão sem telefone não vai — é um contato que não serve para nada", () => {
    expect(() => toNotificameContactContent([{ nome: "Maria", telefones: [] }], "whatsapp"))
      .toThrow();
  });
});
