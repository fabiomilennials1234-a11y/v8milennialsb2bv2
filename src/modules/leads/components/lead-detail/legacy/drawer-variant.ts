/**
 * Legacy DrawerVariant type — used only by the pre-#300 LeadDetailSheet,
 * LeadDetailHeader, and LeadDetailFunnelContext. These files are deprecated
 * and gated behind the `new_lead_modal_v2` feature flag in #301.
 *
 * The active `LeadDetailDialog` (accordion-based) does not consume this type.
 * Do not add new references — call sites now pass an entry id directly to
 * `openLead(leadId, defaultExpandedPipeEntryId?)`.
 */
export type DrawerVariant =
  | "whatsapp"
  | "confirmacao"
  | "propostas"
  | "followup"
  | "custom"
  | "upsell_client"
  | "upsell_campanha"
  | "leads";
