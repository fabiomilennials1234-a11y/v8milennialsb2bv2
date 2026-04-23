/**
 * lead-origins.ts — opções de origem de leads e helpers.
 *
 * Extraído de src/components/chat/LeadDetailContent.tsx (Onda 3.1, C1).
 */

export interface OriginOption {
  value: string;
  label: string;
}

export const originOptions: OriginOption[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "google_ads", label: "Google Ads" },
  { value: "site", label: "Site" },
  { value: "remarketing", label: "Remarketing" },
  { value: "cal", label: "Calendário" },
  { value: "outro", label: "Outro" },
];

export function getOriginLabel(value: string): string {
  return originOptions.find((o) => o.value === value)?.label ?? value;
}
