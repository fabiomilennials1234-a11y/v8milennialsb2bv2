/**
 * useLeadMeta — fachada sobre useLeadByPhone.
 *
 * Onda 3.1, C11. Centraliza a query de lead por telefone para componentes lead/*.
 * NÃO duplica a queryKey — reutiliza o mesmo cache.
 */

export { useLeadByPhone as useLeadMeta } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
