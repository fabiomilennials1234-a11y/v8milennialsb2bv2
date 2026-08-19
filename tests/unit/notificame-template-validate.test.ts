// @vitest-environment node
/**
 * Validação do rascunho de template ANTES de submeter à Meta.
 *
 * POR QUE VALIDAR AQUI, se a Meta valida do lado dela: porque a recusa dela é
 * ASSÍNCRONA E GENÉRICA. O template entra como PENDING, volta REJECTED horas
 * depois, e o motivo costuma ser uma frase que não diz qual regra foi quebrada.
 * O vendedor fica com um template morto e nenhuma pista.
 *
 * As regras cobertas aqui são as que a Meta recusa e que o node do fornecedor
 * NÃO checa (ele repassa o que receber). Cada uma virou teste porque cada uma
 * produz o mesmo sintoma opaco.
 *
 * ⚠️ Os limites numéricos (1024 no corpo, 60 no cabeçalho e no rodapé) vêm da
 * documentação da Meta, não de medição contra conta viva — como todo o resto
 * desta integração até o primeiro canal real existir.
 */
import { describe, it, expect } from "vitest";

import {
  validateTemplateDraft,
  type TemplateDraft,
} from "../../supabase/functions/_shared/notificame-template-validate.ts";

function draft(over: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    name: "boas_vindas",
    language: "pt_BR",
    category: "UTILITY",
    components: [{ type: "BODY", text: "Olá, tudo bem?" }],
    ...over,
  };
}

/** Só o código dos problemas — o texto é para humano, não para asserção. */
function codes(input: TemplateDraft): string[] {
  return validateTemplateDraft(input).map((p) => p.code);
}

describe("validateTemplateDraft — o mínimo viável", () => {
  it("aceita um rascunho correto", () => {
    expect(validateTemplateDraft(draft())).toEqual([]);
  });

  it("exige corpo", () => {
    expect(codes(draft({ components: [{ type: "HEADER", text: "Oi" }] }))).toContain("body_required");
  });

  it("exige texto no corpo", () => {
    expect(codes(draft({ components: [{ type: "BODY", text: "   " }] }))).toContain("body_empty");
  });

  it("recusa categoria desconhecida", () => {
    expect(codes(draft({ category: "PROMO" as TemplateDraft["category"] }))).toContain(
      "category_invalid",
    );
  });

  it("exige idioma", () => {
    expect(codes(draft({ language: "" }))).toContain("language_required");
  });
});

describe("validateTemplateDraft — o nome, que a Meta recusa em silêncio", () => {
  it("recusa maiúscula", () => {
    expect(codes(draft({ name: "BoasVindas" }))).toContain("name_invalid");
  });

  it("recusa espaço", () => {
    expect(codes(draft({ name: "boas vindas" }))).toContain("name_invalid");
  });

  it("recusa acento e hífen", () => {
    expect(codes(draft({ name: "boas-vindas" }))).toContain("name_invalid");
    expect(codes(draft({ name: "saudação" }))).toContain("name_invalid");
  });

  it("aceita minúscula, número e underscore", () => {
    expect(codes(draft({ name: "promo_2026_v2" }))).toEqual([]);
  });

  it("exige nome", () => {
    expect(codes(draft({ name: "" }))).toContain("name_required");
  });
});

describe("validateTemplateDraft — variáveis", () => {
  it("aceita posicionais em sequência a partir de 1", () => {
    // O `example` entra aqui porque a Meta o EXIGE junto com a variável — este
    // teste é sobre a SEQUÊNCIA, e sem o exemplo ele passaria a medir a regra
    // errada. Ver o bloco "exemplo das variáveis" no fim do arquivo.
    expect(codes(draft({
      components: [{
        type: "BODY",
        text: "Oi {{1}}, seu pedido {{2}} saiu",
        example: { body_text: [["Maria", "1234"]] },
      }],
    }))).toEqual([]);
  });

  /**
   * A armadilha mais cara: a Meta exige a sequência COMPLETA. `{{1}}` e `{{3}}`
   * é recusado, e a mensagem de recusa não diz que o problema é o buraco.
   */
  it("recusa buraco na sequência posicional", () => {
    expect(codes(draft({ components: [{ type: "BODY", text: "Oi {{1}}, item {{3}}" }] })))
      .toContain("positional_gap");
  });

  it("recusa sequência que não começa em 1", () => {
    expect(codes(draft({ components: [{ type: "BODY", text: "Oi {{2}}" }] })))
      .toContain("positional_gap");
  });

  it("aceita variáveis nomeadas", () => {
    expect(codes(draft({
      components: [{
        type: "BODY",
        text: "Oi {{nome}}, bem-vindo",
        example: { body_text: [["Maria"]] },
      }],
    }))).toEqual([]);
  });

  it("recusa misturar posicional com nomeada — o formato é um só por template", () => {
    expect(codes(draft({ components: [{ type: "BODY", text: "Oi {{nome}}, item {{1}}" }] })))
      .toContain("parameter_format_mixed");
  });

  it("recusa variável no rodapé — a Meta não permite", () => {
    const d = draft({
      components: [
        { type: "BODY", text: "Olá" },
        { type: "FOOTER", text: "Responda {{1}} para sair" },
      ],
    });
    expect(codes(d)).toContain("footer_no_variables");
  });

  it("recusa mais de uma variável no cabeçalho", () => {
    const d = draft({
      components: [
        { type: "HEADER", format: "TEXT", text: "{{1}} e {{2}}" },
        { type: "BODY", text: "Olá" },
      ],
    });
    expect(codes(d)).toContain("header_too_many_variables");
  });
});

describe("validateTemplateDraft — limites e duplicidade", () => {
  it("recusa corpo acima de 1024 caracteres", () => {
    expect(codes(draft({ components: [{ type: "BODY", text: "x".repeat(1025) }] })))
      .toContain("body_too_long");
  });

  it("recusa rodapé acima de 60 caracteres", () => {
    const d = draft({
      components: [
        { type: "BODY", text: "Olá" },
        { type: "FOOTER", text: "y".repeat(61) },
      ],
    });
    expect(codes(d)).toContain("footer_too_long");
  });

  it("recusa cabeçalho de texto acima de 60 caracteres", () => {
    const d = draft({
      components: [
        { type: "HEADER", format: "TEXT", text: "z".repeat(61) },
        { type: "BODY", text: "Olá" },
      ],
    });
    expect(codes(d)).toContain("header_too_long");
  });

  it("recusa dois corpos", () => {
    const d = draft({
      components: [
        { type: "BODY", text: "Um" },
        { type: "BODY", text: "Dois" },
      ],
    });
    expect(codes(d)).toContain("duplicate_component");
  });

  it("junta todos os problemas em vez de parar no primeiro", () => {
    // Um formulário que devolve um erro por vez faz o usuário submeter cinco
    // vezes para descobrir cinco problemas.
    const problemas = codes(draft({ name: "Nome Errado", language: "", components: [] }));

    expect(problemas).toContain("name_invalid");
    expect(problemas).toContain("language_required");
    expect(problemas).toContain("body_required");
    expect(problemas.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * O EXEMPLO DAS VARIÁVEIS — o campo que morria no meio do caminho.
 *
 * `buildCreateTemplateBody` sempre soube emitir `example`, e o `readDraft` da
 * edge function não lia o campo. Resultado: todo template com `{{1}}` era
 * submetido sem exemplo e recusado pela Meta HORAS depois, com motivo genérico.
 * A tela ainda por cima empurrava para lá — o placeholder do corpo é
 * "Olá {{1}}, seu pedido {{2}}…".
 */
describe("validateTemplateDraft — exemplo das variáveis", () => {
  const base = {
    name: "boas_vindas",
    language: "pt_BR",
    category: "UTILITY" as const,
  };

  it("corpo com variável e SEM exemplo é recusado aqui, não pela Meta", () => {
    const problemas = validateTemplateDraft({
      ...base,
      components: [{ type: "BODY", text: "Olá {{1}}, tudo bem?" }],
    });

    const p = problemas.find((x) => x.code === "body_example_required");
    expect(p).toBeDefined();
    expect(p?.field).toBe("body");
  });

  it("corpo com variável e exemplo passa", () => {
    const problemas = validateTemplateDraft({
      ...base,
      components: [{
        type: "BODY",
        text: "Olá {{1}}, tudo bem?",
        example: { body_text: [["Maria"]] },
      }],
    });

    expect(problemas.filter((x) => x.code.includes("example"))).toEqual([]);
  });

  it("conta os exemplos: duas variáveis com um exemplo só ainda falta", () => {
    const problemas = validateTemplateDraft({
      ...base,
      components: [{
        type: "BODY",
        text: "Olá {{1}}, pedido {{2}}",
        example: { body_text: [["Maria"]] },
      }],
    });

    const p = problemas.find((x) => x.code === "body_example_required");
    expect(p?.message).toContain("2 variáveis");
  });

  it("exemplo em branco não conta como exemplo", () => {
    const problemas = validateTemplateDraft({
      ...base,
      components: [{
        type: "BODY",
        text: "Olá {{1}}",
        example: { body_text: [["   "]] },
      }],
    });

    expect(problemas.some((x) => x.code === "body_example_required")).toBe(true);
  });

  it("o cabeçalho tem a própria chave — header_text, lista simples", () => {
    const comHeaderErrado = validateTemplateDraft({
      ...base,
      components: [
        { type: "HEADER", format: "TEXT", text: "Pedido {{1}}", example: { body_text: [["123"]] } },
        { type: "BODY", text: "Corpo sem variável" },
      ],
    });
    expect(comHeaderErrado.some((x) => x.code === "header_example_required")).toBe(true);

    const comHeaderCerto = validateTemplateDraft({
      ...base,
      components: [
        { type: "HEADER", format: "TEXT", text: "Pedido {{1}}", example: { header_text: ["123"] } },
        { type: "BODY", text: "Corpo sem variável" },
      ],
    });
    expect(comHeaderCerto.some((x) => x.code === "header_example_required")).toBe(false);
  });

  it("template SEM variável não exige exemplo nenhum", () => {
    const problemas = validateTemplateDraft({
      ...base,
      components: [{ type: "BODY", text: "Olá! Podemos continuar por aqui?" }],
    });

    expect(problemas.filter((x) => x.code.includes("example"))).toEqual([]);
  });
});
