/**
 * Onde este painel LÊ e GRAVA. O mesmo painel serve dois assuntos: o nó de
 * template (#1688) e o escape de janela do nó de texto (#1689). São cinco
 * campos idênticos em forma e diferentes em nome, e o nó de texto pode carregar
 * os dois conjuntos ao mesmo tempo — por isso a escolha é um PARÂMETRO e não
 * uma cópia do painel.
 */
export interface CamposDeTemplate {
  name: "templateName" | "escapeTemplateName";
  language: "templateLanguage" | "escapeTemplateLanguage";
  components: "templateComponents" | "escapeTemplateComponents";
  variables: "templateVariables" | "escapeTemplateVariables";
  headerMediaUrl: "templateHeaderMediaUrl" | "escapeTemplateHeaderMediaUrl";
}

export const CAMPOS_DO_NO_DE_TEMPLATE: CamposDeTemplate = {
  name: "templateName",
  language: "templateLanguage",
  components: "templateComponents",
  variables: "templateVariables",
  headerMediaUrl: "templateHeaderMediaUrl",
};

export const CAMPOS_DO_ESCAPE_DE_JANELA: CamposDeTemplate = {
  name: "escapeTemplateName",
  language: "escapeTemplateLanguage",
  components: "escapeTemplateComponents",
  variables: "escapeTemplateVariables",
  headerMediaUrl: "escapeTemplateHeaderMediaUrl",
};
