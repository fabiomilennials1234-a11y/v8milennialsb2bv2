import { normalizeTemplate } from "./notificame-templates.ts";
import {
  midiaDeExemploDoCabecalho, montarComponentesDeEnvio, pendenciasDeEnvio,
  previewDoTemplate, rotulosDosBotoes,
} from "./template-send.ts";
import type { TemplateDoPlano } from "./blast-official-runner.ts";

/** Stored definitions and already-built legacy payloads are different contracts. */
export function prepararTemplateDoDisparo(
  template: TemplateDoPlano,
  snapshot: Record<string, unknown> = {},
): TemplateDoPlano {
  const definition = template.components.some((raw) => {
    const c = raw as Record<string, unknown> | null;
    return c && ("text" in c || "format" in c || "example" in c ||
      String(c.type).toUpperCase() === "BUTTONS");
  });
  if (!definition) return template;

  const normalized = normalizeTemplate({ ...template,
    parameter_format: template.parameterFormat ?? template.parameter_format });
  if (!normalized) throw new Error("Definição de template inválida");
  const values = Object.fromEntries(Object.entries(snapshot)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => [key, String(value)]));
  const media = midiaDeExemploDoCabecalho(normalized);
  const missing = pendenciasDeEnvio(normalized, values, media);
  if (missing.length) throw new Error(`Template incompleto: ${missing.join(", ")}`);
  return {
    ...template,
    components: montarComponentesDeEnvio(normalized, values, media),
    previewText: previewDoTemplate(normalized, values),
    buttonLabels: rotulosDosBotoes(normalized),
  };
}
