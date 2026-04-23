/**
 * LeadDetailContent — re-export do path canônico.
 *
 * C38: o componente principal vive em src/components/chat/LeadDetailContent.tsx
 * (por compatibilidade com WhatsAppChat e LeadContactModal).
 * Este arquivo expõe o mesmo componente a partir do novo path canônico `src/components/lead/`.
 *
 * Subcomponentes modularizados nesta pasta:
 *   - header/LeadHeader.tsx
 *   - tabs/LeadTabHistory.tsx
 *   - tabs/LeadTabInfo.tsx (future)
 *   - tabs/LeadTabPipe.tsx (future)
 *   - tabs/LeadTabTags.tsx (future)
 *   - notes/LeadNotes.tsx (future)
 */
export {
  LeadDetailContent,
  type LeadDetailContentProps,
} from "@/components/chat/LeadDetailContent";
