import { memo } from "react";
import { ResponsibleSlot } from "./ResponsibleSlot";
import { QualificationSlot } from "./QualificationSlot";
import type { QualificationTier } from "../types";

interface LeadActionsBlockProps {
  leadId: string;
  preSaleResponsible: { id: string; name: string; avatar_url?: string | null } | null;
  saleResponsible:    { id: string; name: string; avatar_url?: string | null } | null;
  preQualificationTier: QualificationTier | null;
  /**
   * @deprecated A qualificação passou para o modal do Negócio. A prop fica no
   * contrato porque `leads.qualification_tier` continua existindo e sendo lida
   * pelas métricas — quem monta o header ainda a tem em mãos —, mas o
   * cabeçalho do lead não a edita mais.
   */
  qualificationTier?: QualificationTier | null;
}

/**
 * Header actions sem botão de move stage. Pós-2026-05-19 o stage move
 * acontece nas StageRails do `CrossPipePanel` (pipe-scoped, sempre visíveis).
 *
 * ⚠ SÓ A PRÉ-QUALIFICAÇÃO MORA AQUI. A qualificação saiu para o modal do
 * NEGÓCIO, porque são perguntas de sujeitos diferentes:
 *
 *   pré-qualificação → "vale a pena falar com esta PESSOA?"  ← Lead, aqui
 *   qualificação     → "esta OPORTUNIDADE é boa?"            ← Negócio, lá
 *
 * Um lead com três negócios tem UMA pré-qualificação e pode ter três
 * qualificações distintas. Enquanto as duas dividiam este cabeçalho, avaliar o
 * segundo negócio apagava a nota do primeiro.
 *
 * `leads.qualification_tier` continua existindo e continua sendo o que a
 * família de métricas de qualidade lê — a coluna não foi movida, só deixou de
 * ser editada por aqui.
 */
export const LeadActionsBlock = memo(function LeadActionsBlock({
  leadId,
  preSaleResponsible,
  saleResponsible,
  preQualificationTier,
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
          Pré-qualificação
        </span>
        <div className="flex items-center gap-2">
          <QualificationSlot
            leadId={leadId}
            field="pre_qualification_tier"
            label="Pré-Qualificação"
            current={preQualificationTier}
          />
        </div>
      </div>
    </div>
  );
});
