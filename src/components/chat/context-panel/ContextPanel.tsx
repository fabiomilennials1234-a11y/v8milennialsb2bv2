/**
 * ContextPanel — painel de contexto 3ª coluna do ChatShell.
 *
 * Layout single-scroll (sem tabs): todas as informações do lead em um único
 * painel vertical com seções hierárquicas. Bate com mockup world-class.
 *
 * Seções (ordem):
 *   1. Header — avatar + nome + empresa + score
 *   2. Quick meta — source + responsável
 *   3. Tags (sempre visíveis)
 *   4. Pipelines ativos (jornada)
 *   5. Histórico recente (timeline compacta)
 *   6. AI Timeline (ações do Copilot)
 *   7. CTA — Abrir ficha completa
 */
import { ContextPanelAll } from "./ContextPanelAll";

export interface ContextPanelProps {
  leadId?: string;
  phoneNumber?: string;
  pushName?: string | null;
  onClose?: () => void;
}

export function ContextPanel({ leadId, phoneNumber, pushName }: ContextPanelProps) {
  return (
    <div className="flex flex-col h-full bg-background border-l border-border/60">
      <ContextPanelAll
        leadId={leadId}
        phoneNumber={phoneNumber}
        pushName={pushName}
      />
    </div>
  );
}

// Mantém types legados
export type ContextPanelTab = "info" | "pipe" | "tags" | "history";
