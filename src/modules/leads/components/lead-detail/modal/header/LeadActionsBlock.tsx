import { memo } from "react";
import { ResponsibleSlot } from "./ResponsibleSlot";
import { CoOwnersSlot } from "./CoOwnersSlot";
import { QualificationSlot } from "./QualificationSlot";
import { useLeadOwnersEnabled } from "../../../../hooks/useLeadOwners";
import type { QualificationTier } from "../types";

interface LeadActionsBlockProps {
  leadId: string;
  preSaleResponsible: { id: string; name: string; avatar_url?: string | null } | null;
  saleResponsible:    { id: string; name: string; avatar_url?: string | null } | null;
  preQualificationTier: QualificationTier | null;
  qualificationTier:    QualificationTier | null;
}

/**
 * Header actions sem botão de move stage. Pós-2026-05-19 o stage move
 * acontece nas StageRails do `CrossPipePanel` (pipe-scoped, sempre
 * visíveis). Header só carrega responsáveis + qualificação tiers.
 */
export const LeadActionsBlock = memo(function LeadActionsBlock({
  leadId,
  preSaleResponsible,
  saleResponsible,
  preQualificationTier,
  qualificationTier,
}: LeadActionsBlockProps) {
  // Co-donos (Chamado 793f4b05): só em org com a flag `lead_owners_n_donos`.
  const donosMultiplos = useLeadOwnersEnabled();

  return (
    <div className="flex flex-col items-stretch gap-2 shrink-0 min-w-[180px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold whitespace-nowrap">
          Responsáveis
        </span>
        <div className="flex items-center gap-2">
          <ResponsibleSlot
            leadId={leadId}
            field="pre_sale_responsible_id"
            label="Pré-Venda"
            currentMember={preSaleResponsible}
          />
          <ResponsibleSlot
            leadId={leadId}
            field="sale_responsible_id"
            label="Venda"
            currentMember={saleResponsible}
          />
        </div>
      </div>

      {donosMultiplos && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold whitespace-nowrap">
            Co-donos
          </span>
          <CoOwnersSlot leadId={leadId} />
        </div>
      )}

      <div className="h-px bg-border/40" aria-hidden />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold whitespace-nowrap">
          Qualificação
        </span>
        <div className="flex items-center gap-2">
          <QualificationSlot
            leadId={leadId}
            field="pre_qualification_tier"
            label="Pré-Qualificação"
            current={preQualificationTier}
          />
          <QualificationSlot
            leadId={leadId}
            field="qualification_tier"
            label="Qualificação"
            current={qualificationTier}
          />
        </div>
      </div>
    </div>
  );
});
