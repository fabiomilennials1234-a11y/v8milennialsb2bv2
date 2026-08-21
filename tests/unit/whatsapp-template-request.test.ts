/**
 * A leitura do pedido de envio de template no proxy.
 *
 * ⚠️ Este arquivo IMPORTA a função que o proxy usa — não uma cópia dela. O teste
 * unitário vizinho (`whatsapp-api-proxy.unit.test.ts`) replica a lógica do proxy
 * inline e declara isso no cabeçalho ("grey-box: se a implementação mudar,
 * atualize aqui"); um teste assim segue verde com o defeito vivo.
 *
 * O caminho testado aqui é o que o vendedor usa quando a janela de 24 horas
 * fechou — a hora em que não existe segunda chance de mandar a mensagem.
 */
import { describe, it, expect } from "vitest";

import { readTemplateRequest } from "../../supabase/functions/_shared/whatsapp-template-request.ts";

describe("readTemplateRequest", () => {
  it("lê o corpo que o composer manda", () => {
    expect(
      readTemplateRequest({
        number: "554884334050",
        templateName: "retomada_conversa",
        language: "pt_BR",
      }),
    ).toEqual({
      ok: true,
      value: {
        number: "554884334050",
        templateName: "retomada_conversa",
        language: "pt_BR",
        components: undefined,
      },
    });
  });

  it("aceita snake_case — é o que n8n e workflows produzem", () => {
    const r = readTemplateRequest({
      to: "554884334050",
      template_name: "retomada_conversa",
      language_code: "pt_BR",
    });

    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toMatchObject({
      number: "554884334050",
      templateName: "retomada_conversa",
      language: "pt_BR",
    });
  });

  it("repassa os componentes quando vêm, e só quando são lista", () => {
    const componentes = [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }];

    expect(readTemplateRequest({
      number: "1", templateName: "t", language: "pt_BR", components: componentes,
    })).toMatchObject({ ok: true, value: { components: componentes } });

    // Objeto solto no lugar da lista vira `undefined` em vez de viajar torto até
    // o provider e virar erro do fornecedor.
    expect(readTemplateRequest({
      number: "1", templateName: "t", language: "pt_BR", components: { type: "body" },
    })).toMatchObject({ ok: true, value: { components: undefined } });
  });

  it("recusa campo faltando, dizendo QUAL", () => {
    expect(readTemplateRequest({ templateName: "t", language: "pt_BR" }))
      .toEqual({ ok: false, error: "Missing number" });
    expect(readTemplateRequest({ number: "1", language: "pt_BR" }))
      .toEqual({ ok: false, error: "Missing templateName" });
    expect(readTemplateRequest({ number: "1", templateName: "t" }))
      .toEqual({ ok: false, error: "Missing language" });
  });

  it("NÃO inventa idioma padrão", () => {
    // `pt_BR` seria o palpite óbvio, e erraria em silêncio no dia em que a org
    // aprovar o template em outro idioma: a Meta recusa com "template not found",
    // que não se parece nada com "idioma errado".
    const r = readTemplateRequest({ number: "1", templateName: "t" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("language");
  });

  it("espaço em branco não conta como valor", () => {
    expect(readTemplateRequest({ number: "  ", templateName: "t", language: "pt_BR" }))
      .toEqual({ ok: false, error: "Missing number" });
    expect(readTemplateRequest({ number: "1", templateName: "   ", language: "pt_BR" }))
      .toEqual({ ok: false, error: "Missing templateName" });
  });

  it("apara espaços do que aceita — nome com espaço no fim é template não encontrado", () => {
    expect(readTemplateRequest({
      number: " 554884334050 ", templateName: " retomada ", language: " pt_BR ",
    })).toMatchObject({
      ok: true,
      value: { number: "554884334050", templateName: "retomada", language: "pt_BR" },
    });
  });

  it("corpo vazio ou ausente não explode", () => {
    expect(readTemplateRequest(undefined)).toEqual({ ok: false, error: "Missing number" });
    expect(readTemplateRequest(null)).toEqual({ ok: false, error: "Missing number" });
    expect(readTemplateRequest({})).toEqual({ ok: false, error: "Missing number" });
  });
});

/**
 * O TEXTO RENDERIZADO — o que faz a conversa mostrar a mensagem em vez de
 * "Mensagem interativa".
 *
 * Medido no primeiro template enviado em produção (19/08): a linha nasceu com
 * `message_type: "template"` e `content` NULO, e a bolha caiu no fallback
 * genérico. O provider não tem como renderizar o corpo — a Meta é que monta —,
 * mas quem clica em enviar tem as duas metades: o corpo aprovado e os parâmetros.
 */
describe("readTemplateRequest — texto renderizado", () => {
  const base = { number: "554884334050", templateName: "boas_vindas", language: "pt_BR" };

  it("aceita o texto e o entrega ao provider", () => {
    const r = readTemplateRequest({ ...base, previewText: "Olá Maria, tudo bem?" });
    expect(r.ok && r.value.previewText).toBe("Olá Maria, tudo bem?");
  });

  it("aceita snake_case, como o resto do contrato", () => {
    const r = readTemplateRequest({ ...base, preview_text: "Olá Maria" });
    expect(r.ok && r.value.previewText).toBe("Olá Maria");
  });

  it("é OPCIONAL — quem dispara por automação não tem o corpo aprovado em mãos", () => {
    // Exigir travaria o envio automático por causa de um campo de exibição.
    const r = readTemplateRequest(base);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.previewText).toBeUndefined();
  });

  it("texto em branco não vira texto", () => {
    const r = readTemplateRequest({ ...base, previewText: "   " });
    expect(r.ok && r.value.previewText).toBeUndefined();
  });
});
