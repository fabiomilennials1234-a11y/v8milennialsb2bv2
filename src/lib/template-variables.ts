/**
 * template-variables.ts — resolve variáveis {nome}, {empresa}, etc.
 * em templates de mensagem usando dados do lead e atendente.
 */

export interface TemplateVariableMeta {
  name: string;
  description: string;
}

/** Variáveis disponíveis para uso nos templates (exibidas na UI como badges clicáveis) */
export const TEMPLATE_VARIABLES: TemplateVariableMeta[] = [
  { name: "{nome}", description: "Nome do lead" },
  { name: "{empresa}", description: "Empresa do lead" },
  { name: "{email}", description: "Email do lead" },
  { name: "{telefone}", description: "Telefone do lead" },
  { name: "{origem}", description: "Origem do lead" },
  { name: "{interesse}", description: "Campo de interesse" },
  { name: "{segmento}", description: "Segmento do lead" },
  { name: "{campanha}", description: "Nome da campanha" },
  { name: "{atendente}", description: "Nome do atendente" },
];

export interface LeadContext {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  interest?: string | null;
  segment?: string | null;
  campaign_name?: string | null;
  custom_fields?: Record<string, string | null>;
}

export interface AttendantContext {
  name?: string | null;
}

/**
 * Resolve variáveis no body do template.
 * Variáveis sem valor são substituídas por string vazia.
 */
export function resolveVariables(
  body: string,
  lead: LeadContext,
  attendant: AttendantContext
): string {
  let result = body;

  const replacements: Record<string, string> = {
    "{nome}": lead.name ?? "",
    "{empresa}": lead.company ?? "",
    "{email}": lead.email ?? "",
    "{telefone}": lead.phone ?? "",
    "{origem}": lead.source ?? "",
    "{interesse}": lead.interest ?? "",
    "{segmento}": lead.segment ?? "",
    "{campanha}": lead.campaign_name ?? "",
    "{atendente}": attendant.name ?? "",
  };

  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(key, value);
  }

  // Resolve custom fields: {campo:slug}
  if (lead.custom_fields) {
    result = result.replace(/\{campo:([a-z0-9_-]+)\}/g, (_, slug) => {
      return lead.custom_fields?.[slug] ?? "";
    });
  }

  // Remove any remaining unresolved {campo:xxx} patterns
  result = result.replace(/\{campo:[a-z0-9_-]+\}/g, "");

  return result.trim();
}

/** Dados fictícios para preview na UI de criação de templates */
export const PREVIEW_LEAD: LeadContext = {
  name: "João Silva",
  company: "Empresa XYZ",
  email: "joao@empresa.com",
  phone: "(48) 99999-0000",
  source: "Meta Ads",
  interest: "Plano Pro",
  segment: "Tecnologia",
  campaign_name: "Campanha Março",
  custom_fields: { cnpj: "12.345.678/0001-00" },
};

export const PREVIEW_ATTENDANT: AttendantContext = {
  name: "Maria Santos",
};
