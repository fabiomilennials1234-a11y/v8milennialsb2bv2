/**
 * LeadTabInfo — tab de informações do lead.
 *
 * Onda 3.1, C29 (refactor).
 *
 * Usa LeadFieldGrid para unificar campos padrão + personalizados em grid única.
 * LeadResponsibles, LeadQualification e LeadSource mantidos como sections
 * separadas no topo (são semânticas — papéis, score, origem).
 * AddCustomFieldPopover integrado no final da grid.
 *
 * Props backwards-compat: formData + onChange para campos padrão.
 * onLeadUpdate: callback chamado quando campo inline é salvo (para parent persistir).
 */

import { Loader2, Check, ExternalLink, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { LeadQualification } from "../info/LeadQualification";
import { LeadResponsibles } from "../info/LeadResponsibles";
import { LeadSource } from "../info/LeadSource";
import { LeadNotes } from "../notes/LeadNotes";
import { LeadFieldGrid, type LeadStandardData } from "../info/LeadFieldGrid";
import { AddCustomFieldPopover } from "../info/AddCustomFieldPopover";
import type { LeadContactFormData } from "../info/LeadContactInfo";

interface LeadTag {
  tag: {
    id: string;
    name: string;
    color: string;
  };
}

interface LeadResponsibleRef {
  id: string;
  name: string;
}

interface LeadTabInfoProps {
  leadId: string;
  formData: LeadContactFormData;
  onChange: (data: LeadContactFormData) => void;
  onSave: () => void;
  isSaving?: boolean;
  qualificationScore?: number | null;
  origin?: string | null;
  originDetail?: string | null;
  leadTags?: LeadTag[];
  responsible?: LeadResponsibleRef | null;
  sdr?: LeadResponsibleRef | null;
  closer?: LeadResponsibleRef | null;
  /** Called when grid inline-edits a standard field. Parent should persist to DB. */
  onLeadFieldUpdate?: (field: keyof LeadStandardData, value: string) => void;
}

export function LeadTabInfo({
  leadId,
  formData,
  onChange,
  onSave,
  isSaving = false,
  qualificationScore,
  origin,
  originDetail,
  leadTags = [],
  responsible,
  sdr,
  closer,
  onLeadFieldUpdate,
}: LeadTabInfoProps) {
  // Build LeadStandardData from formData (backwards-compat bridge)
  const leadData: LeadStandardData = {
    name:    formData.name,
    company: formData.company,
    email:   formData.email,
  };

  return (
    <div className="space-y-4">
      {/* Score IA — semântico, fica separado no topo */}
      <LeadQualification qualificationScore={qualificationScore} />

      {/* Responsáveis — SDR/Closer/Responsible, semântico */}
      <LeadResponsibles responsible={responsible} sdr={sdr} closer={closer} />

      {/* Tags (read-only) */}
      {leadTags.length > 0 && (
        <div className="space-y-2">
          <Label>Tags</Label>
          <div className="flex flex-wrap gap-1">
            {leadTags.map((lt) => (
              <Badge
                key={lt.tag.id}
                variant="outline"
                style={{
                  backgroundColor: `${lt.tag.color}20`,
                  borderColor:     `${lt.tag.color}40`,
                  color:           lt.tag.color,
                }}
              >
                <Tag className="w-3 h-3 mr-1" />
                {lt.tag.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Origem */}
      <LeadSource origin={origin} originDetail={originDetail} />

      {/* Notas */}
      <LeadNotes formData={formData} onChange={onChange} />

      {/* Grid unificada — campos padrão + personalizados juntos */}
      <div className="border-t border-border/40 pt-4 mt-4 space-y-1">
        <LeadFieldGrid
          leadId={leadId}
          lead={leadData}
          onLeadUpdate={onLeadFieldUpdate}
        />
        {/* Adicionar campo personalizado inline */}
        <AddCustomFieldPopover />
      </div>

      {/* Ações de save do formData principal (notas, etc.) */}
      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => window.open(`/leads?lead=${leadId}`, "_blank")}
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Ver Completo
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Check className="w-4 h-4 mr-2" />
          )}
          Salvar
        </Button>
      </div>
    </div>
  );
}
