/**
 * LeadTabInfo — tab de informações do lead.
 *
 * Orquestra: LeadContactInfo + LeadQualification + LeadNotes + LeadSource + LeadResponsibles.
 * Extraído de LeadDetailContent (Onda 3.1, C8).
 */

import { Loader2, Check, ExternalLink, Tag, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { LeadContactInfo } from "@/components/lead/info/LeadContactInfo";
import { LeadQualification } from "@/components/lead/info/LeadQualification";
import { LeadResponsibles } from "@/components/lead/info/LeadResponsibles";
import { LeadSource } from "@/components/lead/info/LeadSource";
import { LeadCustomFields } from "@/components/lead/info/LeadCustomFields";
import { LeadNotes } from "@/components/lead/notes/LeadNotes";
import type { LeadContactFormData } from "@/components/lead/info/LeadContactInfo";

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
}: LeadTabInfoProps) {
  return (
    <div className="space-y-4">
      {/* Contact fields: nome, empresa, email */}
      <LeadContactInfo formData={formData} onChange={onChange} />

      {/* Rating + score IA */}
      <LeadQualification
        formData={formData}
        onChange={onChange}
        qualificationScore={qualificationScore}
      />

      {/* Notas */}
      <LeadNotes formData={formData} onChange={onChange} />

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
                  borderColor: `${lt.tag.color}40`,
                  color: lt.tag.color,
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

      {/* Responsáveis */}
      <LeadResponsibles responsible={responsible} sdr={sdr} closer={closer} />

      {/* Campos personalizados */}
      <div className="border-t border-border/40 pt-4 mt-4 space-y-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Campos personalizados
          </Label>
        </div>
        <LeadCustomFields leadId={leadId} />
      </div>

      {/* Ações */}
      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => window.open(`/leads?id=${leadId}`, "_blank")}
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
