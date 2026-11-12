// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as front from "../../src/modules/communication/lib/template-send";
import * as edge from "../../supabase/functions/_shared/template-send.ts";
import { graphComponentsToTemplateComponents } from "../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts";
import { buildTemplateSendContent } from "../../supabase/functions/_shared/notificame-templates.ts";

for (const [runtime, builder] of [["chat", front], ["workflow", edge]] as const) {
  describe(`named template through provider: ${runtime}`, () => {
    for (const format of ["NAMED", null] as const) {
      it(`preserves body names with an image header (${format})`, () => {
        const template = {
          name: "blackchique2026", id: "test", language: "pt_BR",
          status: "APPROVED" as const, category: "MARKETING" as const,
          parameterFormat: format,
          components: [
            { type: "HEADER", format: "IMAGE" },
            { type: "BODY", text: "Olá {{nome_cliente}}!" },
          ],
        };
        const components = builder.montarComponentesDeEnvio(template,
          { nome_cliente: "Vida Farma" }, "https://example.com/header.png");
        const content = buildTemplateSendContent({ name: template.name,
          languageCode: "pt_BR", components: graphComponentsToTemplateComponents(components) });
        expect(content).toMatchObject({ template: { components: [
          { type: "header", parameters: [{ type: "image", image: { link: "https://example.com/header.png" } }] },
          { type: "body", parameters: [{ type: "text", text: "Vida Farma", parameter_name: "nome_cliente" }] },
        ] } });
      });
    }
    it("keeps positional templates and URL buttons unchanged", () => {
      const components = builder.montarComponentesDeEnvio({
        name: "other_org", id: "test", language: "pt_BR", status: "APPROVED",
        category: "UTILITY", parameterFormat: "POSITIONAL",
        components: [{ type: "BODY", text: "Olá {{1}}, pedido {{2}}" },
          { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://example.com/{{1}}" }] }],
      }, { "2": "123", "1": "Maria" }, null, { 0: "pedido" });
      const content = buildTemplateSendContent({ name: "other_org", languageCode: "pt_BR",
        components: graphComponentsToTemplateComponents(components) });
      expect(JSON.stringify(content)).not.toContain("parameter_name");
      expect(components).toEqual([
        { type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "123" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "pedido" }] },
      ]);
    });
    it("names text header and body parameters independently", () => {
      expect(builder.montarComponentesDeEnvio({
        name: "named", id: "test", language: "pt_BR", status: "APPROVED",
        category: "UTILITY", parameterFormat: "NAMED",
        components: [{ type: "HEADER", text: "Pedido {{pedido}}" }, { type: "BODY", text: "Olá {{nome}}" }],
      }, { nome: "Maria", pedido: "123" })).toEqual([
        { type: "header", parameters: [{ type: "text", text: "123", parameter_name: "pedido" }] },
        { type: "body", parameters: [{ type: "text", text: "Maria", parameter_name: "nome" }] },
      ]);
    });
    it("does not add names to numeric tokens when format is missing", () => {
      expect(builder.montarComponentesDeEnvio({
        name: "legacy", id: "test", language: "pt_BR", status: "APPROVED",
        category: "UTILITY", parameterFormat: null,
        components: [{ type: "BODY", text: "Olá {{1}}" }],
      }, { "1": "Maria" })).toEqual([
        { type: "body", parameters: [{ type: "text", text: "Maria" }] },
      ]);
    });
    it("does not invent parameters for templates without variables", () => {
      expect(builder.montarComponentesDeEnvio({
        name: "static", id: "test", language: "pt_BR", status: "APPROVED",
        category: "UTILITY", parameterFormat: "NAMED",
        components: [{ type: "BODY", text: "Olá!" }],
      }, {})).toEqual([]);
    });
  });
}

it("preserves the internal camelCase parameter name", () => {
  expect(graphComponentsToTemplateComponents([{ type: "body", parameters: [
    { type: "text", text: "Maria", parameterName: "nome" },
  ] }])).toEqual([{ type: "body", parameters: [{ type: "text", text: "Maria", parameterName: "nome" }] }]);
});
