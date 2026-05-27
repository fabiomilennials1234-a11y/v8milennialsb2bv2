/**
 * LeadQualification — rating editável e qualification_score (read-only).
 *
 * Extraído de LeadDetailContent (Onda 3.1, C3).
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { LeadContactFormData } from "./LeadContactInfo";

interface LeadQualificationProps {
  formData: LeadContactFormData;
  onChange: (data: LeadContactFormData) => void;
  qualificationScore?: number | null;
}

export function LeadQualification({
  formData,
  onChange,
  qualificationScore,
}: LeadQualificationProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="edit-rating">Rating (0-10)</Label>
        <Input
          id="edit-rating"
          type="number"
          min="0"
          max="10"
          value={formData.rating}
          onChange={(e) =>
            onChange({ ...formData, rating: parseInt(e.target.value) || 0 })
          }
        />
      </div>

      {qualificationScore != null && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Score IA:</span>
          <Badge variant="outline" className="text-xs">
            {qualificationScore}%
          </Badge>
        </div>
      )}
    </div>
  );
}
