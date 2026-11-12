// @vitest-environment node
import { describe, expect, it } from "vitest";
import { prepararTemplateDoDisparo } from "../../supabase/functions/_shared/blast-template-send.ts";
import { graphComponentsToTemplateComponents } from "../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts";
import { buildTemplateSendContent } from "../../supabase/functions/_shared/notificame-templates.ts";

export const definition = {
  name: "blackchique2026", language: "pt_BR", previewText: "Olá {{nome}}", buttonLabels: [],
  components: [
    { type: "HEADER", format: "IMAGE", example: { header_handle: ["https://example.com/header.png"] } },
    { type: "BODY", text: "Olá {{nome}}!" },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sim" }, { type: "URL", text: "Site", url: "https://example.com" }] },
  ],
};

describe("frozen blast definition → per-recipient provider envelope", () => {
  it("uses each frozen name, sends image and named body, not the BUTTONS definition", () => {
    for (const nome of ["Vida Farma", "Outra Farmácia"]) {
      const prepared = prepararTemplateDoDisparo(definition, { nome });
      expect(prepared.previewText).toBe(`Olá ${nome}!`);
      expect(prepared.buttonLabels).toEqual(["Sim", "Site"]);
      expect(buildTemplateSendContent({ name: prepared.name, languageCode: prepared.language,
        components: graphComponentsToTemplateComponents(prepared.components) })).toEqual({
        type: "template", template: { name: "blackchique2026", language: { code: "pt_BR" }, components: [
          { type: "header", parameters: [{ type: "image", image: { link: "https://example.com/header.png" } }] },
          { type: "body", parameters: [{ type: "text", text: nome, parameter_name: "nome" }] },
        ] },
      });
    }
    expect(definition.components[1].text).toBe("Olá {{nome}}!");
  });
  it("blocks missing personalization rather than sending empty parameters", () => {
    expect(() => prepararTemplateDoDisparo(definition, {})).toThrow("{{nome}}");
  });
  it("preserves already-built legacy payloads", () => {
    const ready = { ...definition, components: [{ type: "body", parameters: [{ type: "text", text: "Maria" }] }] };
    expect(prepararTemplateDoDisparo(ready, { nome: "Outro" })).toBe(ready);
  });
  it("preserves numeric parameter semantics", () => {
    const prepared = prepararTemplateDoDisparo({ ...definition, parameterFormat: "POSITIONAL",
      components: [{ type: "BODY", text: "Pedido {{1}}" }] }, { "1": 123 });
    expect(prepared.components).toEqual([{ type: "body", parameters: [{ type: "text", text: "123" }] }]);
  });
  it("refuses dynamic URL buttons without values instead of copying their definitions", () => {
    const template = { ...definition, components: [{ type: "BUTTONS", buttons: [
      { type: "URL", text: "Pedido", url: "https://example.com/{{1}}" },
    ] }] };
    expect(() => prepararTemplateDoDisparo(template)).toThrow("link do botão");
  });
});
