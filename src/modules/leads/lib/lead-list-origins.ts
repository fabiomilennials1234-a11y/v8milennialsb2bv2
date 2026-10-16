/**
 * Origens oferecidas no filtro "Origem" da lista de Leads e da Carteira.
 *
 * As duas telas filtram o mesmo campo (`leads.origin`) com o mesmo recorte do
 * banco — a lista mora num lugar só para que o filtro de uma nunca ofereça uma
 * origem que a outra não conhece.
 */
export const LEAD_LIST_ORIGIN_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  outro: "Outros",
  site: "Site",
  remarketing: "Remarketing",
  google_ads: "Google Ads",
  cal: "Cal.com",
  indicacao: "Indicação",
};
