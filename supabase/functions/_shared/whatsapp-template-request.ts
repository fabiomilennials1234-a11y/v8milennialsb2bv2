/**
 * A leitura do pedido de envio de TEMPLATE que chega ao `whatsapp-api-proxy`.
 *
 * ─── POR QUE É UM MÓDULO, E NÃO DEZ LINHAS DENTRO DO `switch` ───────────────
 *
 * O teste unitário do proxy hoje REPLICA a lógica dele inline ("grey-box: se a
 * implementação mudar, atualize aqui"). Teste que copia o predicado em vez de
 * importá-lo continua verde com o defeito vivo — e este caminho é o que o
 * vendedor vai usar quando a janela de 24 horas fechar, que é justamente quando
 * não há segunda chance de mandar a mensagem.
 *
 * Aqui mora só a leitura do corpo. A validação SEMÂNTICA (nome, idioma, forma
 * dos botões) é do provider, em `buildTemplateSendContent` — duplicá-la faria
 * duas validações do mesmo contrato divergirem no primeiro campo novo.
 */
import type { SendTemplateOptions } from "./whatsapp-client.ts";

export type TemplateRequest =
  | { ok: true; value: SendTemplateOptions }
  | { ok: false; error: string };

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * ⚠️ ACEITA camelCase E snake_case no mesmo campo.
 *
 * Não é indulgência: o composer manda `templateName`, e os produtores
 * automáticos deste produto (n8n, workflows) mandam tudo em snake_case, com todo
 * valor como string. Recusar um dos dois faria o mesmo template funcionar na tela
 * e falhar no disparo — com a mensagem de erro apontando para o campo certo pelo
 * nome errado.
 */
export function readTemplateRequest(payload: unknown): TemplateRequest {
  const p = (payload ?? {}) as Record<string, unknown>;

  const number = texto(p.number) ?? texto(p.to);
  const templateName = texto(p.templateName) ?? texto(p.template_name) ?? texto(p.name);
  const language = texto(p.language) ?? texto(p.language_code) ?? texto(p.languageCode);

  if (!number) return { ok: false, error: "Missing number" };
  if (!templateName) return { ok: false, error: "Missing templateName" };
  // O idioma NÃO tem default. `pt_BR` seria o palpite óbvio e erraria em silêncio
  // no dia em que a org aprovar o template em outro idioma: a Meta recusa por
  // "template not found", que não se parece nada com "idioma errado".
  if (!language) return { ok: false, error: "Missing language" };

  const components = Array.isArray(p.components) ? p.components : undefined;

  // O texto renderizado é OPCIONAL: quem dispara por automação não o tem, e a
  // ausência dele não pode impedir o envio — só deixa a linha sem prévia.
  const previewText = texto(p.previewText) ?? texto(p.preview_text) ?? undefined;

  return { ok: true, value: { number, templateName, language, components, previewText } };
}
