import { memo } from "react";
import { ResponsibleSlot } from "./ResponsibleSlot";
import { QualificationSlot } from "./QualificationSlot";
import type { QualificationTier } from "../types";

interface LeadActionsBlockProps {
  leadId: string;
  preSaleResponsible: { id: string; name: string; avatar_url?: string | null } | null;
  saleResponsible:    { id: string; name: string; avatar_url?: string | null } | null;
  preQualificationTier: QualificationTier | null;
  qualificationTier:    QualificationTier | null;
}

/**
 * Header actions sem MoveStageButton — pós-#300 o stage move acontece
 * dentro do LeadCrossPipeAccordion (pipe-scoped). Header só carrega
 * responsáveis + qualificação tiers.
 */
export const LeadActionsBlock = memo(function LeadActionsBlock({
  leadId,
  preSaleResponsible,
  saleResponsible,
  preQualificationTier,
  qualificationTier,
}: LeadActionsBlockProps) {
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
