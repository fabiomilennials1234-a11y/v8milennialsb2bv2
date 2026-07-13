/**
 * Configuração canônica dos campos do lead exibidos nos blocos info.
 * Ordem aqui controla ordem de display nos blocos 1 (preenchidos) e 2 (faltantes).
 */
export interface LeadInfoFieldConfig {
  key: string;             // chave em `leads` (ou virtual pra campos compostos)
  label: string;
  type?: "text" | "textarea" | "currency" | "phone" | "email" | "origin";
  readOnly?: boolean;      // campos não editáveis (tracking/UTM/meta ids)
  group?: "form" | "tracking";
}

export const LEAD_INFO_FIELDS: LeadInfoFieldConfig[] = [
  { key: "name",        label: "Nome",          group: "form" },
  { key: "company",     label: "Empresa",       group: "form" },
  { key: "phone",       label: "Telefone",      group: "form", type: "phone" },
  { key: "email",       label: "Email",         group: "form", type: "email" },
  { key: "segment",     label: "Segmento",      group: "form" },
  { key: "urgency",     label: "Urgência",      group: "form" },
  { key: "faturamento", label: "Faturamento",   group: "form", type: "currency" },
  { key: "notes",       label: "Observações",   group: "form", type: "textarea" },
];

export const LEAD_TRACKING_FIELDS: LeadInfoFieldConfig[] = [
  { key: "origin",          label: "Origem",         group: "tracking", type: "origin" },
  { key: "utm_campaign",    label: "UTM Campaign",   group: "tracking", readOnly: true },
  { key: "utm_source",      label: "UTM Source",     group: "tracking", readOnly: true },
  { key: "utm_medium",      label: "UTM Medium",     group: "tracking", readOnly: true },
  { key: "utm_content",     label: "UTM Content",    group: "tracking", readOnly: true },
  { key: "utm_term",        label: "UTM Term",       group: "tracking", readOnly: true },
  { key: "meta_campaign_id",label: "Meta Campaign ID", group: "tracking", readOnly: true },
  { key: "meta_adset_id",   label: "Meta AdSet ID",    group: "tracking", readOnly: true },
  { key: "meta_ad_id",      label: "Meta Ad ID",       group: "tracking", readOnly: true },
];
