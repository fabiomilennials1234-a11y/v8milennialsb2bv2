/**
 * LeadQualification — `qualification_score` (read-only).
 *
 * Extraído de LeadDetailContent (Onda 3.1, C3). O input de `rating` saiu em
 * 2026-09-03 com a remoção do calor da interface; a qualificação (score/tier)
 * permanece.
 */

import { Badge } from "@/components/ui/badge";

interface LeadQualificationProps {
  qualificationScore?: number | null;
}

export function LeadQualification({ qualificationScore }: LeadQualificationProps) {
  if (qualificationScore == null) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Score IA:</span>
      <Badge variant="outline" className="text-xs">
        {qualificationScore}%
      </Badge>
    </div>
  );
}
