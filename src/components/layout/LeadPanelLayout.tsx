import { type ReactNode } from "react";

/**
 * @deprecated Substituído pelo `LeadDetailDialog` centralizado (2026-05-17).
 *
 * Mantido como wrapper transparente pra evitar churn nos 12+ call sites.
 * O painel (geralmente `<LeadDetailSheet />`) agora é um Dialog que se gerencia
 * sozinho — basta renderizá-lo como sibling.
 *
 * Antes:
 *   <LeadPanelProvider>
 *     <LeadPanelLayout panel={<LeadDetailSheet />}>{children}</LeadPanelLayout>
 *   </LeadPanelProvider>
 *
 * Comportamento atual:
 *   • Children ocupam fullwidth (sem split-pane).
 *   • Panel (Dialog) é renderizado como sibling e flutua centralizado quando aberto.
 */
interface LeadPanelLayoutProps {
  children: ReactNode;
  panel?: ReactNode;
}

export function LeadPanelLayout({ children, panel }: LeadPanelLayoutProps) {
  return (
    <>
      {children}
      {panel}
    </>
  );
}
